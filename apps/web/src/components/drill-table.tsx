"use client";
// A comparison table whose figures open what they are made of (docs/UX_PRINCIPLES.md,
// law 19). Each cell with a breakdown is a button; the breakdown opens under the
// table, one at a time, and Close returns focus to the cell that opened it.
import { type ReactNode, useId, useRef, useState } from "react";
import type { Breakdown } from "@/lib/breakdown";
import { BreakdownPanel } from "./breakdown";

export interface DrillCell {
  content: ReactNode;
  breakdown?: Breakdown | null;
}

export interface DrillTableRow {
  label: string;
  cells: DrillCell[];
}

export function DrillTable({
  columns,
  rows,
  caption,
  firstColumn,
  testId,
  minWidth = "min-w-[560px]",
}: {
  columns: string[];
  rows: DrillTableRow[];
  /** What the table compares, for screen readers. */
  caption: string;
  /** Heading of the row-label column. */
  firstColumn: string;
  testId?: string;
  minWidth?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const panelId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [ri, ci] = open ? open.split(":").map(Number) : [];
  const picked = open ? rows[ri ?? -1]?.cells[ci ?? -1]?.breakdown : null;
  return (
    // min-w-0: only the table scrolls sideways, never the page (a grid item's minimum is its content).
    <div className="flex min-w-0 flex-col gap-3">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard */}
      <section className="overflow-x-auto" aria-label={caption} tabIndex={0}>
        <table className={`w-full ${minWidth} text-sm`} data-testid={testId}>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="py-2 font-medium">{firstColumn}</th>
              {columns.map((c) => (
                <th key={c} className="py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className="border-b border-line last:border-b-0">
                <td className="py-2">{r.label}</td>
                {r.cells.map((cell, j) => {
                  const key = `${i}:${j}`;
                  const isOpen = open === key;
                  return (
                    <td key={columns[j] ?? j} className="num py-1">
                      {cell.breakdown ? (
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) buttons.current.set(key, el);
                            else buttons.current.delete(key);
                          }}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => setOpen(isOpen ? null : key)}
                          className={`relative -mx-2 inline-flex min-h-10 items-center rounded-lg px-2 text-left underline decoration-dotted underline-offset-4 hover:bg-surface-2 pointer-coarse:min-h-11 ${
                            isOpen ? "bg-surface-2 text-accent" : ""
                          }`}
                        >
                          <span>{cell.content}</span>
                          <span className="sr-only">, see how it is worked out</span>
                        </button>
                      ) : (
                        cell.content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {picked ? (
        <section
          id={panelId}
          aria-label={`${picked.title} breakdown`}
          className="rounded-2xl border border-accent bg-surface p-5"
        >
          <BreakdownPanel
            key={picked.id}
            b={picked}
            onClose={() => {
              const k = open;
              setOpen(null);
              if (k) buttons.current.get(k)?.focus();
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
