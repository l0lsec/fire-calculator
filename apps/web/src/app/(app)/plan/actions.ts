"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/context";
import { type ActionResult, formObject } from "@/server/forms";
import {
  removeContribution,
  removeIncome,
  removePerson,
  saveContribution,
  saveIncome,
  savePerson,
  saveSpending,
} from "@/server/profile";
import { addAdjustment, removeAdjustment, saveAssumptions } from "@/server/scenarios";

const done = (r: ActionResult) => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

export async function savePersonAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return done(await savePerson(ctx, v, v.id || undefined));
}
export async function deletePersonAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return done(await removePerson(ctx, String(fd.get("id"))));
}
export async function saveIncomeAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return done(await saveIncome(ctx, v, v.id || undefined));
}
export async function deleteIncomeAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return done(await removeIncome(ctx, String(fd.get("id"))));
}
export async function saveContributionAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return done(await saveContribution(ctx, v, v.id || undefined));
}
export async function deleteContributionAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return done(await removeContribution(ctx, String(fd.get("id"))));
}
export async function saveSpendingAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return done(await saveSpending(ctx, formObject(fd)));
}
export async function saveAssumptionsAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return done(await saveAssumptions(ctx, String(v.scenarioId), v));
}
export async function addAdjustmentAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  const v = formObject(fd);
  return done(await addAdjustment(ctx, String(v.scenarioId), v));
}
export async function removeAdjustmentAction(_: ActionResult | null, fd: FormData) {
  const ctx = await requireContext();
  return done(await removeAdjustment(ctx, String(fd.get("scenarioId")), String(fd.get("adjustmentId"))));
}
