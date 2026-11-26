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
  if (!r.ok) return r;
  const n = r.data?.set ?? 0;
  return {
    ok: true,
    data: {
      message: n
        ? `Set ${n} ${n === 1 ? "budget" : "budgets"} from your typical month. Change any of them below.`
        : "Every category already has a budget.",
    },
  };
}
