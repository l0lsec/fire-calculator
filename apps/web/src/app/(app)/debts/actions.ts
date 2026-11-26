"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { removeDebt, saveDebt, setDebtRate } from "@/server/debts";
import { type ActionResult, formObject } from "@/server/forms";
import { saveDebtPlan } from "@/server/scenarios";

export async function saveDebtAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const v = formObject(fd);
  const r = await saveDebt(ctx, v, v.id || undefined);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function deleteDebtAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await removeDebt(ctx, String(fd.get("id") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function saveDebtPlanAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await saveDebtPlan(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function saveDebtRateAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await setDebtRate(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
