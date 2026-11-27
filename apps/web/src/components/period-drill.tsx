"use client";
// What one bar or point of a chart is made of (docs/UX_PRINCIPLES.md, law 19).
// A chart over time gets one breakdown per period; tapping a bar or a point picks
// it, and so does the menu under the chart (for keyboards and screen readers).
// The picked period opens below with its lines, and each line opens its charges.
import { useId } from "react";
import type { Breakdown } from "@/lib/breakdown";
import { BreakdownPanel } from "./breakdown";

export function PeriodDrill({
  periods,
  picked,
  onPick,
  noun = "month",
  testId,
}: {
  /** One per chart row, in the same order; null when that period has nothing to show. */
  periods: (Breakdown | null)[];
  picked: number | null;
  onPick: (index: number | null) => void;
  noun?: string;
  testId?: string;
}) {
  const selectId = useId();
  const open = picked === null ? null : (periods[picked] ?? null);
  if (!periods.some(Boolean)) return null;
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={selectId} className="text-ink-2">
          Tap the chart, or pick a {noun}, to see what it is made of
        </label>
        <select
          id={selectId}
          value={picked === null ? "" : String(picked)}
          onChange={(e) => onPick(e.target.value === "" ? null : Number(e.target.value))}
          className="min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink pointer-coarse:min-h-11"
          data-testid={testId ? `${testId}-pick` : undefined}
        >
          <option value="">Choose a {noun}</option>
          {periods.map((p, i) =>
            p ? (
              <option key={p.id} value={i}>
                {p.title}
              </option>
            ) : null,
          )}
        </select>
      </div>
      {open ? (
        <section
          aria-label={`${open.title} breakdown`}
          className="rounded-2xl border border-accent bg-surface p-5"
        >
          <BreakdownPanel key={open.id} b={open} onClose={() => onPick(null)} />
        </section>
      ) : null}
    </div>
  );
}

/** Recharts reports the bar or point under the pointer as a string index (or null). */
export function pickedIndex(state: { activeTooltipIndex?: unknown } | null | undefined): number | null {
  const i = state?.activeTooltipIndex;
  if (i === null || i === undefined || i === "") return null;
  const n = Number(i);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
