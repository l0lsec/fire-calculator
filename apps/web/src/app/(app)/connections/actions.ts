"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import type { ActionResult } from "@/server/forms";
import { plaidConfigured, plaidDeps } from "@/server/plaid/config";
import { deleteAllData, disconnectItem } from "@/server/plaid/items";
import { syncItem } from "@/server/plaid/sync";

export async function refreshItemAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await syncItem(ctx, await plaidDeps(), String(fd.get("itemId")));
  revalidatePath("/", "layout");
  return r.status === "ok"
    ? { ok: true }
    : { ok: false, error: `Bank reported ${r.errorCode ?? "an error"}` };
}

export async function refreshAfterUpdate(itemId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await syncItem(ctx, await plaidDeps(), itemId);
  revalidatePath("/", "layout");
  return r.status === "ok" ? { ok: true } : { ok: false, error: r.errorCode ?? "error" };
}

export async function disconnectAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await disconnectItem(ctx, await plaidDeps(), String(fd.get("itemId")));
  revalidatePath("/", "layout");
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Could not disconnect" };
}

export async function deleteEverythingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (
    String(fd.get("confirm") ?? "")
      .trim()
      .toUpperCase() !== "DELETE"
  ) {
    return { ok: false, fieldErrors: { confirm: "Type DELETE to confirm" } };
  }
  await deleteAllData(ctx, plaidConfigured() ? await plaidDeps() : null);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
