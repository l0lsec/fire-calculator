"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import type { ActionResult } from "@/server/forms";
import { duplicateScenario, ensureBaseline, removeScenario, renameScenario } from "@/server/scenarios";

export async function createWhatIfAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const from = String(fd.get("from") || (await ensureBaseline(ctx)).id);
  const r = await duplicateScenario(ctx, from, String(fd.get("name") ?? ""));
  if (!r.ok || !r.data) return r;
  revalidatePath("/scenarios");
  redirect(`/plan?scenario=${r.data.id}`);
}

export async function renameAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await renameScenario(ctx, String(fd.get("id")), String(fd.get("name") ?? ""));
  if (r.ok) revalidatePath("/scenarios");
  return r;
}

export async function deleteScenarioAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await removeScenario(ctx, String(fd.get("id")));
  if (r.ok) revalidatePath("/scenarios");
  return r;
}
