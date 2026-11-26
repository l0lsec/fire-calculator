// Shared pieces for the charts: one tooltip, one legend and one table view, so every
// chart reads the same way. Colors come from the --chart-1..5 tokens in a fixed
// order (validated with the dataviz palette checker); text always wears the ink
// tokens, never a series color.
import type { ReactNode } from "react";
import { usd } from "@/lib/format";

/** Categorical slots in their fixed order; slot 5 is the neutral gray kept for "Other". */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"] as const;
export const OTHER = "var(--chart-5)";

export const AXIS_TICK = { fontSize: 11, fill: "var(--ink-3)" } as const;
export const compactUsd = (v: number) => usd(v, { compact: true });

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** A dash pattern for lines, the second channel beside color. */
  dash?: string;
}

/** The legend: a swatch for bars and areas, a short line for lines. */
export function ChartLegend({ series, shape }: { series: SeriesDef[]; shape: "rect" | "line" }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {shape === "rect" ? (
            <span className="size-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
          ) : (
            <svg width="18" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="17"
                y2="4"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={s.dash}
              />
            </svg>
          )}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface TipEntry {
  dataKey?: string | number | ((...args: never[]) => unknown);
  value?: unknown;
}

/**
 * Tooltip content: the label, then every series at that point with the value
 * first and the name after, each keyed by a short line of its color.
 */
export function SeriesTooltip({
  active,
  label,
  payload,
  series,
  total,
  format = (v: number) => usd(v),
}: {
  active?: boolean;
  label?: ReactNode;
  payload?: readonly TipEntry[];
  series: SeriesDef[];
  total?: string;
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const value = (key: string) => {
    const e = payload.find((p) => p.dataKey === key);
    return typeof e?.value === "number" ? e.value : null;
  };
  const shown = series.filter((s) => value(s.key) !== null);
  const sum = shown.reduce((v, s) => v + (value(s.key) ?? 0), 0);
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 text-ink-3">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {[...shown].reverse().map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <svg width="10" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="10" y2="2" stroke={s.color} strokeWidth="3" />
            </svg>
            <span className="num font-semibold text-ink">{format(value(s.key) ?? 0)}</span>
            <span className="text-ink-2">{s.label}</span>
          </li>
        ))}
        {total ? (
          <li className="mt-0.5 flex items-center gap-2 border-t border-line pt-1">
            <span className="w-2.5" aria-hidden="true" />
            <span className="num font-semibold text-ink">{format(sum)}</span>
            <span className="text-ink-2">{total}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** The table view: every value in the chart, one click away and never hover-only. */
export function ChartTable({
  caption,
  columns,
  rows,
  testId,
}: {
  caption: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, ReactNode>[];
  testId?: string;
}) {
  return (
    <details className="text-sm" data-testid={testId}>
      <summary className="flex min-h-10 cursor-pointer items-center text-xs text-ink-2 hover:text-ink pointer-coarse:min-h-11">
        Show as a table
      </summary>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard */}
      <section className="max-h-80 overflow-auto" aria-label={caption} tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`py-1.5 font-medium ${c.align === "left" ? "text-left" : "text-right"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
              <tr key={i} className="border-b border-line last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className={`num py-1.5 ${c.align === "left" ? "text-left" : "text-right"}`}>
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </details>
  );
}
