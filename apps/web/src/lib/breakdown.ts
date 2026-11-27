// What a summary number is made of, as plain data a server page builds and the
// breakdown panel shows. Safe for client and server (no server imports).
//
// A breakdown is one or more steps. Each step is a short calculation read top to
// bottom: start at zero, apply each line in order (+, -, x, /), and the result is
// the step's total. `evaluateStep` does exactly that, so a unit test can prove the
// lines on screen produce the figure on the tile.
//
// A line built from transactions carries them in `charges`, so it opens the real
// charges it is made of (docs/UX_PRINCIPLES.md, law 19).
import type { Charge } from "./charges";

export type BreakdownFormat = "usd" | "pct" | "number";

export interface BreakdownLine {
  op: "+" | "-" | "×" | "÷";
  label: string;
  /** Dollars for + and -; a plain factor for × and ÷ (0.04 for 4%). */
  value: number;
  /** How to show `value` (defaults to "usd"). */
  format?: BreakdownFormat;
  /** A short reason or source, shown under the label. */
  detail?: string;
  testId?: string;
  /** The transactions this line is made of; the panel lets each line open them. */
  charges?: Charge[];
  /** The charges are money coming in (pay): show them as positive amounts. */
  chargesIn?: boolean;
}

export interface BreakdownStep {
  title?: string;
  lines: BreakdownLine[];
  total: { label: string; value: number; format?: BreakdownFormat; testId?: string };
}

/** Something that could have been counted but is not, and why. */
export interface NotCounted {
  label: string;
  value: number;
  reason: string;
}

export interface Breakdown {
  id: string;
  title: string;
  /** One sentence: what the number means and where it comes from. */
  intro: string;
  steps: BreakdownStep[];
  notCounted?: NotCounted[];
  /** Context that is not part of the sum (assumptions, dates). */
  facts?: { label: string; value: string }[];
  /** Where each input is changed. */
  links: { href: string; label: string }[];
  /** A donut of the same figure split into parts (see foldSlices). */
  chart?: { title: string; slices: Slice[] };
}

export interface Slice {
  label: string;
  value: number;
  /** The folded remainder, drawn in the neutral color. */
  other?: boolean;
}

/**
 * Parts of a whole as donut slices: positive parts only, largest first, at most
 * `max` named slices and the rest folded into "Other" (never more hues than the
 * palette has).
 */
export function foldSlices(parts: { label: string; value: number }[], max = 4): Slice[] {
  const merged = new Map<string, number>();
  for (const p of parts) if (p.value > 0.005) merged.set(p.label, (merged.get(p.label) ?? 0) + p.value);
  const sorted = [...merged].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (sorted.length <= max + 1) return sorted;
  const rest = sorted.slice(max).reduce((s, x) => s + x.value, 0);
  return [...sorted.slice(0, max), { label: "Other", value: rest, other: true }];
}

/** Apply a step's lines in order, starting from zero. */
export function evaluateStep(step: BreakdownStep): number {
  let v = 0;
  for (const l of step.lines) {
    if (l.op === "+") v += l.value;
    else if (l.op === "-") v -= l.value;
    else if (l.op === "×") v *= l.value;
    else v = l.value === 0 ? 0 : v / l.value;
  }
  return v;
}
