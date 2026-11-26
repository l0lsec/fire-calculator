"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { saveBudget, suggestBudgets } from "@/server/insights";

export async function saveBudgetAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await saveBudget(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function suggestBudgetsAction(_: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await suggestBudgets(ctx);
  revalidatePath("/", "layout");
  return r;
}
