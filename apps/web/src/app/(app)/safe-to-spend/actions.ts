"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { addBill, recordMove, removeBill, removeMove, restoreMove, saveCushion } from "@/server/insights";

export async function saveCushionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await saveCushion(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function addBillAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await addBill(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function removeBillAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await removeBill(ctx, String(fd.get("id") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function recordMoveAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await recordMove(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function removeMoveAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await removeMove(ctx, String(fd.get("id") ?? ""));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function restoreMoveAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await restoreMove(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
