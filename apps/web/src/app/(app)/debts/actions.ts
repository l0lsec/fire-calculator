"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { removeDebt, saveDebt, setDebtRate } from "@/server/debts";
import { type ActionResult, formObject } from "@/server/forms";
import { withFiEffect } from "@/server/plan-effect";
import { saveDebtPlan } from "@/server/scenarios";

export async function saveDebtAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const v = formObject(fd);
  const r = await withFiEffect(ctx, v.id ? "Saved." : `Added ${v.name || "debt"}.`, () =>
    saveDebt(ctx, v, v.id || undefined),
  );
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}

export async function deleteDebtAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await withFiEffect(ctx, "Deleted.", () => removeDebt(ctx, String(fd.get("id") ?? "")));
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}

export async function saveDebtPlanAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const v = formObject(fd);
  const r = await withFiEffect(
    ctx,
    "Saved to your plan.",
    () => saveDebtPlan(ctx, v),
    v.scenarioId || undefined,
  );
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}

export async function saveDebtRateAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await withFiEffect(ctx, "Rate saved.", () => setDebtRate(ctx, formObject(fd)));
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}
