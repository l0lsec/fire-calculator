"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { removeManualAccount, saveManualAccount } from "@/server/accounts";
import { type ActionResult, formObject } from "@/server/forms";

export async function saveAccountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const input = formObject(fd);
  const r = await saveManualAccount(ctx, input, input.id || undefined);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function deleteAccountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await removeManualAccount(ctx, String(fd.get("id") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
