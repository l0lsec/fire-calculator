"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type CreatedKey, createKey, restoreKey, revokeKey } from "@/server/agent/keys";
import { type ActionResult, formObject } from "@/server/forms";

export async function createKeyAction(
  _: ActionResult | null,
  fd: FormData,
): Promise<ActionResult<CreatedKey>> {
  const ctx = await requireContext();
  const r = await createKey(ctx, formObject(fd));
  if (r.ok) revalidatePath("/ai-access");
  return r;
}

export async function revokeKeyAction(
  _: ActionResult | null,
  fd: FormData,
): Promise<ActionResult<{ message: string; undo: Record<string, string> }>> {
  const ctx = await requireContext();
  const r = await revokeKey(ctx, String(fd.get("id") ?? ""));
  revalidatePath("/ai-access");
  return r;
}

export async function restoreKeyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await restoreKey(ctx, String(fd.get("id") ?? ""));
  revalidatePath("/ai-access");
  return r;
}
