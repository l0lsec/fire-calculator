"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { dismissAlert, restoreAlert, saveAlertSettings } from "@/server/insights";

export async function dismissAlertAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await dismissAlert(ctx, String(fd.get("key") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function restoreAlertAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await restoreAlert(ctx, String(fd.get("key") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function saveAlertSettingsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await saveAlertSettings(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
