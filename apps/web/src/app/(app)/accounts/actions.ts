"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { removeManualAccount, saveManualAccount } from "@/server/accounts";
import { type ActionResult, formObject } from "@/server/forms";
import { withFiEffect } from "@/server/plan-effect";

export async function saveAccountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const input = formObject(fd);
  const r = await withFiEffect(ctx, input.id ? "Saved." : `Added ${input.name || "account"}.`, () =>
    saveManualAccount(ctx, input, input.id || undefined),
  );
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}

export async function deleteAccountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await withFiEffect(ctx, "Deleted.", () => removeManualAccount(ctx, String(fd.get("id") ?? "")));
  if (r.ok) revalidatePath("/", "layout");
  return r as ActionResult;
}
