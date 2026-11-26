"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import { saveCushion } from "@/server/insights";

export async function saveCushionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await saveCushion(ctx, formObject(fd));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
