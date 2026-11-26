"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { decide, setAccountBusiness, setCategoryEssential, useMeasuredSpending } from "@/server/spending";

export async function decideAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await decide(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function categoryEssentialAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await setCategoryEssential(ctx, String(fd.get("category")), fd.get("essential") === "true");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function useMeasuredAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await useMeasuredSpending(ctx, fd.get("use") === "true");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function accountBusinessAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await setAccountBusiness(ctx, String(fd.get("id") ?? ""), fd.get("business") === "true");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
