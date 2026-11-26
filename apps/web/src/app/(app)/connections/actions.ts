"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/auth/supabase";
import { explainError } from "@/lib/explain-error";
import { importFromIphone, pairIphone, unpairIphone } from "@/server/financekit";
import type { ActionResult } from "@/server/forms";
import { plaidConfigured, plaidDeps } from "@/server/plaid/config";
import { completeUpdateMode, deleteAllData, disconnectItem } from "@/server/plaid/items";
import { syncItem } from "@/server/plaid/sync";

export async function refreshItemAction(
  _: ActionResult | null,
  fd: FormData,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  const r = await syncItem(ctx, await plaidDeps(), String(fd.get("itemId")));
  revalidatePath("/", "layout");
  return r.status === "ok"
    ? { ok: true, data: { message: "Updated: balances and transactions are current." } }
    : { ok: false, error: explainError({ code: r.errorCode }, "plaid") };
}

export async function refreshAfterUpdate(itemId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await completeUpdateMode(ctx, await plaidDeps(), itemId);
  revalidatePath("/", "layout");
  return r.status === "ok" ? { ok: true } : { ok: false, error: r.errorCode ?? "error" };
}

export async function disconnectAction(
  _: ActionResult | null,
  fd: FormData,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  const r = await disconnectItem(ctx, await plaidDeps(), String(fd.get("itemId")));
  revalidatePath("/", "layout");
  return r.ok
    ? { ok: true, data: { message: "Disconnected. Its accounts stay in your history." } }
    : { ok: false, error: r.error ?? "Could not disconnect. Try again in a minute." };
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

// ---------- iPhone companion (FinanceKit) ----------

export async function pairIphoneAction(
  _: ActionResult<{ code: string }> | null,
  _fd: FormData,
): Promise<ActionResult<{ code: string }>> {
  const ctx = await requireContext();
  try {
    const { code } = await pairIphone(ctx);
    revalidatePath("/connections");
    return { ok: true, data: { code } };
  } catch {
    return { ok: false, error: "Could not create a pairing code. Is TOKEN_ENCRYPTION_KEYS set?" };
  }
}

export async function unpairIphoneAction(
  _: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  await unpairIphone(ctx);
  revalidatePath("/", "layout");
  return { ok: true, data: { message: "Unpaired. The iPhone's accounts stay in your history." } };
}

export async function importIphoneAction(
  _: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult<{ message: string }>> {
  const ctx = await requireContext();
  const r = await importFromIphone(ctx, { force: true });
  revalidatePath("/", "layout");
  if (r.status === "imported")
    return {
      ok: true,
      data: {
        message: `Imported ${r.accounts} accounts and ${r.transactions} transactions from the iPhone.`,
      },
    };
  if (r.status === "unchanged") return { ok: true, data: { message: "Already up to date." } };
  const why: Record<string, string> = {
    "not-paired": "No iPhone is paired.",
    "no-file": "Nothing from the iPhone yet. Open FIRE Planner Sync on the phone and tap Sync now.",
    downloading: "iCloud is still downloading the latest sync. Try again in a minute.",
  };
  return {
    ok: false,
    error: r.error ? explainError(r.error, "iphone") : (why[r.status] ?? explainError(null, "iphone")),
  };
}
