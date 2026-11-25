// Household profile: people, income, payroll contributions and manual spending.
import {
  createContributionStream,
  createIncomeStream,
  createPerson,
  type Db,
  deleteContributionStream,
  deleteIncomeStream,
  deletePerson,
  type HouseholdScope,
  listPeople,
  setSpendingProfile,
  updateContributionStream,
  updateIncomeStream,
  updatePerson,
} from "@fire/db";
import { monthIndex } from "@fire/engine/core";
import { z } from "zod";
import { type ActionResult, dollars, parseForm } from "../forms";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

const birthMonth = z.string().transform((s, ctx) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s.trim());
  if (!m) {
    ctx.addIssue({ code: "custom", message: "Use YYYY-MM" });
    return z.NEVER;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12) {
    ctx.addIssue({ code: "custom", message: "Enter a real month" });
    return z.NEVER;
  }
  return monthIndex(y, mo);
});

export const PersonForm = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  birth: birthMonth,
});

export async function savePerson(
  ctx: Ctx,
  input: Record<string, string>,
  id?: string,
): Promise<ActionResult> {
  const parsed = parseForm(PersonForm, input);
  if ("result" in parsed) return parsed.result;
  const values = { name: parsed.data.name, birthMonth: parsed.data.birth };
  if (id)
    return (await updatePerson(ctx.db, ctx.scope, id, values))
      ? { ok: true }
      : { ok: false, error: "Not found" };
  try {
    await createPerson(ctx.db, ctx.scope, values);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true };
}

export async function removePerson(ctx: Ctx, id: string): Promise<ActionResult> {
  const people = await listPeople(ctx.db, ctx.scope);
  if (people.length <= 1) return { ok: false, error: "The plan needs at least one person" };
  return (await deletePerson(ctx.db, ctx.scope, id)) ? { ok: true } : { ok: false, error: "Not found" };
}

const optionalAge = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 120) {
      ctx.addIssue({ code: "custom", message: "Enter an age, or leave blank" });
      return z.NEVER;
    }
    return n;
  });

export const IncomeForm = z.object({
  personId: z.string().uuid("Choose a person"),
  name: z.string().trim().min(1, "Name this income").max(60),
  kind: z.enum(["takeHome", "partTime", "socialSecurity", "pension", "other"]),
  monthly: dollars({ max: 10_000_000 }),
  growth: z.enum(["raise", "inflation", "none"]),
  phase: z.enum(["working", "retired", "always"]),
  startAge: optionalAge,
  endAge: optionalAge,
});

export async function saveIncome(
  ctx: Ctx,
  input: Record<string, string>,
  id?: string,
): Promise<ActionResult> {
  const parsed = parseForm(IncomeForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  if (v.startAge !== null && v.endAge !== null && v.endAge <= v.startAge) {
    return { ok: false, fieldErrors: { endAge: "Must be after the start age" } };
  }
  const values = {
    personId: v.personId,
    name: v.name,
    kind: v.kind,
    monthlyCents: v.monthly as number,
    growth: v.growth,
    phase: v.phase,
    startAge: v.startAge,
    endAge: v.endAge,
  };
  try {
    if (id) {
      return (await updateIncomeStream(ctx.db, ctx.scope, id, values))
        ? { ok: true }
        : { ok: false, error: "Not found" };
    }
    await createIncomeStream(ctx.db, ctx.scope, values);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true };
}

export async function removeIncome(ctx: Ctx, id: string): Promise<ActionResult> {
  return (await deleteIncomeStream(ctx.db, ctx.scope, id)) ? { ok: true } : { ok: false, error: "Not found" };
}

export const ContributionForm = z.object({
  name: z.string().trim().min(1, "Name this contribution").max(60),
  bucket: z.enum(["traditional", "roth", "hsa", "taxable", "cash"]),
  monthly: dollars({ max: 1_000_000 }),
});

export async function saveContribution(
  ctx: Ctx,
  input: Record<string, string>,
  id?: string,
): Promise<ActionResult> {
  const parsed = parseForm(ContributionForm, input);
  if ("result" in parsed) return parsed.result;
  const values = {
    name: parsed.data.name,
    bucket: parsed.data.bucket,
    monthlyCents: parsed.data.monthly as number,
  };
  if (id) {
    return (await updateContributionStream(ctx.db, ctx.scope, id, values))
      ? { ok: true }
      : { ok: false, error: "Not found" };
  }
  await createContributionStream(ctx.db, ctx.scope, values);
  return { ok: true };
}

export async function removeContribution(ctx: Ctx, id: string): Promise<ActionResult> {
  return (await deleteContributionStream(ctx.db, ctx.scope, id))
    ? { ok: true }
    : { ok: false, error: "Not found" };
}

export const SpendingForm = z
  .object({
    source: z.enum(["manual", "plaid"]),
    annual: dollars({ optional: true, max: 100_000_000 }),
    essential: dollars({ optional: true, max: 100_000_000 }),
  })
  .superRefine((v, ctx) => {
    if (v.source === "manual" && (v.annual === null || v.annual === 0)) {
      ctx.addIssue({ code: "custom", path: ["annual"], message: "Enter your annual spending" });
    }
    if (v.annual !== null && v.essential !== null && v.essential > v.annual) {
      ctx.addIssue({
        code: "custom",
        path: ["essential"],
        message: "Essentials cannot exceed total spending",
      });
    }
  });

export async function saveSpending(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = parseForm(SpendingForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  await setSpendingProfile(ctx.db, ctx.scope, {
    source: v.source,
    ...(v.annual !== null ? { manualAnnualCents: v.annual } : {}),
    ...(v.essential !== null ? { manualEssentialCents: v.essential } : {}),
  });
  return { ok: true };
}
