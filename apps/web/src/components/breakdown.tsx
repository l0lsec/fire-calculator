"use client";
// Drill-down for summary numbers: tap a number and what it is made of opens right
// under it, in place. One pattern for every summary number in the app:
//   - DrillTiles: a grid of number tiles; one breakdown open at a time, shown on
//     its own row under the tapped tile (the grid backfills, so tiles never move
//     out of order). The open tile follows the URL hash (#savings-rate), so other
//     pages can link straight to a breakdown.
//   - DrillRow: a list row (the FI ladder) whose breakdown opens inside the row.
// Both render the same BreakdownPanel. Opening is instant: the data is already on
// the page.
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Breakdown, type BreakdownFormat, type BreakdownLine, evaluateStep } from "@/lib/breakdown";
import { pct, usd } from "@/lib/format";
import { Donut } from "./charts/donut";

function fmt(value: number, format: BreakdownFormat = "usd"): string {
  if (format === "pct") return pct(value, 2);
  if (format === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return usd(value);
}

const OP_TEXT: Record<BreakdownLine["op"], string> = {
  "+": "plus",
  "-": "minus",
  "×": "times",
  "÷": "divided by",
};

export function BreakdownPanel({ b, onClose }: { b: Breakdown; onClose?: () => void }) {
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid={`breakdown-${b.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-ink">{b.title}: how it adds up</h3>
          <p className="text-ink-2">{b.intro}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm text-ink-2 hover:bg-surface-2 pointer-coarse:min-h-11"
          >
            Close
          </button>
        ) : null}
      </div>

      {b.chart ? (
        <Donut title={b.chart.title} slices={b.chart.slices} testId={`breakdown-${b.id}-chart`} />
      ) : null}

      {b.steps.map((step, i) => (
        <div key={`${b.id}-${i}`} className="flex flex-col gap-1">
          {step.title ? <p className="text-xs font-medium text-ink-3">{step.title}</p> : null}
          <ol className="flex flex-col">
            {step.lines.map((l, j) => (
              <li
                key={`${l.label}-${j}`}
                className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2 py-1"
                data-testid={l.testId}
              >
                <span className="text-ink-3" aria-hidden="true">
                  {j === 0 && l.op === "+" ? "" : l.op === "-" ? "−" : l.op}
                </span>
                <span className="min-w-0">
                  {j === 0 && l.op === "+" ? null : <span className="sr-only">{OP_TEXT[l.op]} </span>}
                  <span className="text-ink">{l.label}</span>
                  {l.detail ? <span className="block text-xs text-ink-3">{l.detail}</span> : null}
                </span>
                <span className="num text-right text-ink">{fmt(l.value, l.format)}</span>
              </li>
            ))}
            <li
              className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-x-2 border-t border-line pt-2"
              data-testid={step.total.testId}
            >
              <span className="text-ink-3" aria-hidden="true">
                =
              </span>
              <span className="font-medium text-ink">
                <span className="sr-only">equals </span>
                {step.total.label}
              </span>
              <span className="num text-right font-semibold text-ink">
                {fmt(step.total.value, step.total.format)}
              </span>
            </li>
          </ol>
        </div>
      ))}

      {b.facts?.length ? (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {b.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-ink-3">{f.label}</dt>
              <dd className="num text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {b.notCounted?.length ? (
        <div className="flex flex-col gap-1" data-testid={`breakdown-${b.id}-not-counted`}>
          <p className="text-xs font-medium text-ink-3">Not counted</p>
          <ul className="flex flex-col">
            {b.notCounted.map((n) => (
              <li key={n.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 py-1">
                <span className="min-w-0">
                  <span className="text-ink">{n.label}</span>
                  <span className="block text-xs text-ink-3">{n.reason}</span>
                </span>
                <span className="num text-right text-ink-3">{usd(n.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {b.links.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-3">Change or see more on</span>
          {b.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm text-ink hover:bg-surface-2 pointer-coarse:min-h-11"
            >
              {l.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** True when every step's lines produce its total; a dev-time guard against a breakdown that lies. */
function addsUp(b: Breakdown) {
  return b.steps.every((s) => Math.abs(evaluateStep(s) - s.total.value) < 0.01);
}

export interface Tile {
  id: string;
  label: string;
  figure: ReactNode;
  sub?: ReactNode;
  /** data-testid of the figure (kept stable for the e2e specs). */
  testId: string;
  breakdown: Breakdown;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function DrillTiles({
  tiles,
  className = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  tiles: Tile[];
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // Open the tile named in the URL hash (a link from another page, or a reload).
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (tiles.some((t) => t.id === id)) setOpen(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tiles]);

  const toggle = (id: string | null) => {
    setOpen(id);
    const url = `${window.location.pathname}${window.location.search}${id ? `#${id}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  };
  const close = (id: string) => {
    toggle(null);
    buttons.current.get(id)?.focus();
  };

  return (
    <div className={`grid grid-flow-row-dense gap-4 ${className}`}>
      {tiles.flatMap((t) => {
        const isOpen = open === t.id;
        const panelId = `${base}-${t.id}`;
        const tile = (
          <button
            key={t.id}
            id={t.id}
            ref={(el) => {
              if (el) buttons.current.set(t.id, el);
              else buttons.current.delete(t.id);
            }}
            type="button"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => toggle(isOpen ? null : t.id)}
            data-testid={`tile-${t.id}`}
            className={`flex min-h-10 scroll-mt-20 flex-col items-start gap-0.5 rounded-2xl border bg-surface p-5 text-left transition-colors hover:bg-surface-2 ${
              isOpen ? "border-accent" : "border-line"
            }`}
          >
            <span className="text-xs text-ink-3">{t.label}</span>
            <span className="num text-2xl font-semibold text-ink" data-testid={t.testId}>
              {t.figure}
            </span>
            {t.sub ? <span className="num text-xs text-ink-3">{t.sub}</span> : null}
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
              {isOpen ? "Hide the breakdown" : "See how it adds up"}
              <Chevron open={isOpen} />
            </span>
          </button>
        );
        if (!isOpen) return [tile];
        return [
          tile,
          <section
            key={`${t.id}-panel`}
            id={panelId}
            aria-label={`${t.label} breakdown`}
            className="col-span-full rounded-2xl border border-accent bg-surface p-5"
          >
            {process.env.NODE_ENV !== "production" && !addsUp(t.breakdown) ? (
              <p className="mb-2 text-xs text-bad">This breakdown does not add up (development check).</p>
            ) : null}
            <BreakdownPanel b={t.breakdown} onClose={() => close(t.id)} />
          </section>,
        ];
      })}
    </div>
  );
}

/** A row (the FI ladder) whose breakdown opens inside it. `summary` is the row's visible content. */
export function DrillRow({
  breakdown,
  summary,
  testId,
}: {
  breakdown: Breakdown;
  summary: ReactNode;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li data-testid={testId} className={`rounded-xl border ${open ? "border-accent" : "border-line"}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full flex-col gap-0 rounded-xl p-3 text-left transition-colors hover:bg-surface-2"
      >
        {summary}
      </button>
      {open ? (
        <div id={panelId} className="border-t border-line p-3">
          <BreakdownPanel b={breakdown} />
        </div>
      ) : null}
    </li>
  );
}
