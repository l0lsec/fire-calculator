"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { withFiEffect } from "@/server/plan-effect";
import {
  decide,
  setCategoryEssential,
  useMeasuredSpending as setMeasuredSpending,
  undoCategoryEssential,
  undoDecision,
} from "@/server/spending";

export async function decideAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = (await withFiEffect(ctx, "", () => decide(ctx, formObject(fd)))) as ActionResult;
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function categoryEssentialAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = (await withFiEffect(ctx, "", () =>
    setCategoryEssential(ctx, String(fd.get("category")), fd.get("essential") === "true"),
  )) as ActionResult;
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function useMeasuredAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const use = fd.get("use") === "true";
  const r = (await withFiEffect(
    ctx,
    use ? "Your plan now uses measured spending." : "Your plan now uses your own estimate.",
    () => setMeasuredSpending(ctx, use),
  )) as ActionResult;
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function undoDecisionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await undoDecision(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function undoCategoryEssentialAction(
  _: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await undoCategoryEssential(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
