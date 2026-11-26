"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import type { ActionResult } from "@/server/forms";
import { hideRecurring } from "@/server/insights";

export async function hideRecurringAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await hideRecurring(ctx, String(fd.get("key") ?? ""), fd.get("hide") !== "false");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
