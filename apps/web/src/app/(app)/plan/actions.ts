"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { withFiEffect } from "@/server/plan-effect";
import {
  removeContribution,
  removeIncome,
  removePerson,
  saveContribution,
  saveIncome,
  savePerson,
  saveSpending,
} from "@/server/profile";
import { addAdjustment, removeAdjustment, saveAssumptions } from "@/server/scenarios";

const done = (r: ActionResult) => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

type Ctx = Awaited<ReturnType<typeof requireContext>>;
/** Saves, then says how the change moved the FI date. */
const effect = async (ctx: Ctx, base: string, change: () => Promise<ActionResult>, scenarioId?: string) =>
  done((await withFiEffect(ctx, base, change, scenarioId)) as ActionResult);

export async function savePersonAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return effect(ctx, v.id ? "Saved." : `Added ${v.name || "person"}.`, () =>
    savePerson(ctx, v, v.id || undefined),
  );
}
export async function deletePersonAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return effect(ctx, "Removed.", () => removePerson(ctx, String(fd.get("id"))));
}
export async function saveIncomeAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return effect(ctx, v.id ? "Saved." : `Added ${v.name || "income"}.`, () =>
    saveIncome(ctx, v, v.id || undefined),
  );
}
export async function deleteIncomeAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return effect(ctx, "Removed.", () => removeIncome(ctx, String(fd.get("id"))));
}
export async function saveContributionAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return effect(ctx, v.id ? "Saved." : `Added ${v.name || "contribution"}.`, () =>
    saveContribution(ctx, v, v.id || undefined),
  );
}
export async function deleteContributionAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return effect(ctx, "Removed.", () => removeContribution(ctx, String(fd.get("id"))));
}
export async function saveSpendingAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return effect(ctx, "Saved.", () => saveSpending(ctx, formObject(fd)));
}
export async function saveAssumptionsAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return effect(ctx, "Saved.", () => saveAssumptions(ctx, String(v.scenarioId), v), String(v.scenarioId));
}
export async function addAdjustmentAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return effect(
    ctx,
    `Added ${v.label || "line"}.`,
    () => addAdjustment(ctx, String(v.scenarioId), v),
    String(v.scenarioId),
  );
}
export async function removeAdjustmentAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const scenarioId = String(fd.get("scenarioId"));
  return effect(
    ctx,
    "Removed.",
    () => removeAdjustment(ctx, scenarioId, String(fd.get("adjustmentId"))),
    scenarioId,
  );
}
