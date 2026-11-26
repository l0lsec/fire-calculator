// Every save ends on its effect: run the plan before and after a change and
// say, in one sentence, how the FI date moved. The UI shows the sentence as
// the save's confirmation (ActionForm and ButtonForm read data.message).
import type { Db, HouseholdScope } from "@fire/db";
import { duration, monthName } from "@/lib/format";
import type { ActionResult } from "./forms";
import { planForScenario } from "./snapshot";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

/** The plan's FI month, null when FI is not reached, undefined when the plan cannot run yet. */
export async function fiMonth(ctx: Ctx, scenarioId?: string | null): Promise<number | null | undefined> {
  try {
    const p = await planForScenario(ctx, scenarioId);
    if (!p.input || !p.result) return undefined;
    return p.result.fiK === null ? null : p.input.startMonth + p.result.fiK;
  } catch {
    return undefined;
  }
}

/** One sentence for a move from `before` to `after` (see fiMonth for the meaning of each value). */
export function describeFiMove(before: number | null | undefined, after: number | null | undefined): string {
  if (after === undefined) return "";
  if (after === null)
    return before == null
      ? "FI is not reached within the plan yet."
      : `FI is no longer reached within the plan (it was ${monthName(before)}).`;
  if (before == null) return `Your FI date is now ${monthName(after)}.`;
  if (after === before) return `FI date unchanged: ${monthName(after)}.`;
  const span = duration(Math.abs(after - before));
  return after < before
    ? `FI date moved ${span} earlier: ${monthName(before)} to ${monthName(after)}.`
    : `FI date moved ${span} later: ${monthName(before)} to ${monthName(after)}.`;
}

/**
 * Runs `change` and, when it succeeds, returns `base` (or, when `base` is
 * empty, the change's own data.message) plus how the FI date moved, as
 * data.message. Other data (an Undo payload) is kept. A failed change is
 * returned unchanged.
 */
export async function withFiEffect<T>(
  ctx: Ctx,
  base: string,
  change: () => Promise<ActionResult<T>>,
  scenarioId?: string | null,
): Promise<ActionResult<T | { message: string }>> {
  const before = await fiMonth(ctx, scenarioId);
  const r = await change();
  if (!r.ok) return r;
  const after = await fiMonth(ctx, scenarioId);
  const move = describeFiMove(before, after);
  const data = r.data && typeof r.data === "object" ? (r.data as { message?: unknown }) : {};
  // An empty base keeps the change's own message ("Netflix: one-time, ...").
  const lead = base || (typeof data.message === "string" ? data.message : "Saved.");
  return { ok: true, data: { ...data, message: move ? `${lead} ${move}` : lead } };
}
