"use client";
// The charges behind a number, opened in place under it. Every figure built from
// transactions gets one (docs/UX_PRINCIPLES.md, law 19): tap "See the 5 charges"
// and the real transactions appear, newest first, with a total line. Opening is
// instant: the data is already on the page.
import { type ReactNode, useId, useState } from "react";
import { type Charge, chargesTotal } from "@/lib/charges";
import { dateText, usdCents } from "@/lib/format";

/** Long lists show this many rows until "Show all" is pressed. */
const FIRST = 25;

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

export function ChargeList({
  charges,
  testId,
  explain,
  totalLabel = "Total",
  /** "in" shows money arriving (pay) as positive amounts. */
  direction = "out",
  noun = "charge",
  label,
}: {
  charges: Charge[];
  testId?: string;
  /** How these charges make the number (shown above the list). */
  explain?: ReactNode;
  totalLabel?: string;
  direction?: "out" | "in";
  noun?: string;
  /** Button text when closed, in place of "See the 5 charges". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const panelId = useId();
  if (charges.length === 0) return null;
  const sign = direction === "in" ? -1 : 1;
  const shown = all ? charges : charges.slice(0, FIRST);
  const n = charges.length;
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-10 items-center gap-1 self-start rounded-lg px-2 -ml-2 text-xs font-medium text-accent hover:bg-surface-2 pointer-coarse:min-h-11"
      >
        {open ? `Hide the ${noun}s` : (label ?? `See the ${n} ${noun}${n === 1 ? "" : "s"}`)}
        <Chevron open={open} />
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
          {explain ? <div className="text-xs text-ink-2">{explain}</div> : null}
          <ol className="flex flex-col divide-y divide-line">
            {shown.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 py-1.5"
                data-testid="charge-row"
              >
                <span className="num text-xs text-ink-3">{dateText(c.date)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-ink">{c.name}</span>
                  <span className="block text-xs text-ink-3">
                    {c.account}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                </span>
                <span className="num text-right text-ink">
                  {usdCents(sign * c.amountCents, { cents: true })}
                </span>
              </li>
            ))}
          </ol>
          {n > FIRST && !all ? (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="inline-flex min-h-10 items-center self-start rounded-lg px-2 -ml-2 text-xs font-medium text-accent hover:bg-surface-2 pointer-coarse:min-h-11"
            >
              Show all {n}
            </button>
          ) : null}
          <p
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-t border-line pt-2"
            data-testid={testId ? `${testId}-total` : undefined}
          >
            <span className="font-medium text-ink">
              {totalLabel} of {n} {noun}
              {n === 1 ? "" : "s"}
            </span>
            <span className="num text-right font-semibold text-ink">
              {usdCents(sign * chargesTotal(charges), { cents: true })}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
