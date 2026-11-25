// Scenarios: the baseline plan and any number of what-ifs.
import {
  createScenario,
  type Db,
  deleteScenario,
  getBaselineScenario,
  getScenario,
  type HouseholdScope,
  listScenarios,
  updateScenario,
} from "@fire/db";
import { Assumptions, DebtPlan, DebtPolicy, IncomeStream, SpendingAdjustment } from "@fire/engine/core";
import { z } from "zod";
import { type ActionResult, checkbox, dollars, parseForm, percent } from "../forms";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export type ScenarioRow = NonNullable<Awaited<ReturnType<typeof getScenario>>>;

export const DEFAULT_ADJUSTMENTS: SpendingAdjustment[] = [
  {
    id: "health-until-65",
    label: "Health insurance until Medicare",
    annual: 7200,
    essential: true,
    untilAge: 65,
  },
];

/** The stored scenario, validated: assumptions and plans with engine defaults filled in. */
export function readScenario(row: ScenarioRow) {
  return {
    id: row.id,
    name: row.name,
    isBaseline: row.isBaseline,
    assumptions: Assumptions.parse(row.assumptions ?? {}),
    debtPlan: DebtPlan.parse(row.debtPlan ?? {}),
    policy: DebtPolicy.parse(row.policy),
    retirementAdjustments: z.array(SpendingAdjustment).parse(row.retirementAdjustments ?? []),
    extraIncome: z.array(IncomeStream).parse(row.extraIncome ?? []),
    spendingOverrideCents: row.spendingOverrideCents,
  };
}
export type Scenario = ReturnType<typeof readScenario>;

export async function ensureBaseline(ctx: Ctx): Promise<ScenarioRow> {
  const existing = await getBaselineScenario(ctx.db, ctx.scope);
  if (existing) return existing;
  return createScenario(ctx.db, ctx.scope, {
    name: "My plan",
    isBaseline: true,
    assumptions: {},
    debtPlan: {},
    policy: "payoffAtFI",
    retirementAdjustments: DEFAULT_ADJUSTMENTS,
    extraIncome: [],
  });
}

export async function loadScenario(ctx: Ctx, id?: string | null): Promise<ScenarioRow> {
  if (id) {
    const row = await getScenario(ctx.db, ctx.scope, id);
    if (row) return row;
  }
  return ensureBaseline(ctx);
}

export async function allScenarios(ctx: Ctx) {
  await ensureBaseline(ctx);
  return listScenarios(ctx.db, ctx.scope);
}

// ---------- assumptions form ----------

export const AssumptionsForm = z.object({
  nominalReturn: percent({ min: -20, max: 30 }),
  inflation: percent({ min: -5, max: 20 }),
  cashReturn: percent({ min: -5, max: 20 }),
  raiseRate: percent({ min: -20, max: 30 }),
  swr: percent({ min: 0.5, max: 20 }),
  retirementAge: z.coerce.number().min(30, "Between 30 and 90").max(90, "Between 30 and 90"),
  lifeExpectancy: z.coerce.number().min(50, "Between 50 and 120").max(120, "Between 50 and 120"),
  emergencyMonths: z.coerce.number().min(0).max(36),
  fatMultiplier: z.coerce.number().min(1, "At least 1").max(10),
  withdrawalTaxRate: percent({ min: 0, max: 60 }),
  retireMode: z.enum(["fi", "age"]),
  retireAge: z.coerce.number().min(18).max(100).optional(),
  partTimeAnnual: dollars({ optional: true, max: 10_000_000 }),
  partTimeHealth: dollars({ optional: true, max: 1_000_000 }),
  partTimeUntil: z.string().optional(),
  countGuaranteedIncome: checkbox,
  policy: DebtPolicy,
  strategy: z.enum(["avalanche", "snowball", "custom", "hybrid", "minimum"]),
  extraMonthly: dollars({ max: 1_000_000 }),
  hybridThreshold: percent({ max: 100 }),
});

export async function saveAssumptions(
  ctx: Ctx,
  id: string,
  input: Record<string, string>,
): Promise<ActionResult> {
  const row = await getScenario(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "Scenario not found" };
  const parsed = parseForm(AssumptionsForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  if (v.lifeExpectancy <= v.retirementAge) {
    return { ok: false, fieldErrors: { lifeExpectancy: "Must be after the retirement age" } };
  }
  const prev = readScenario(row);
  const untilAge = v.partTimeUntil ? Number(v.partTimeUntil) : undefined;
  if (untilAge !== undefined && (!Number.isFinite(untilAge) || untilAge < 18 || untilAge > 100)) {
    return { ok: false, fieldErrors: { partTimeUntil: "Enter an age between 18 and 100, or leave blank" } };
  }
  const assumptions = Assumptions.parse({
    ...prev.assumptions,
    nominalReturn: v.nominalReturn,
    inflation: v.inflation,
    cashReturn: v.cashReturn,
    raiseRate: v.raiseRate,
    swr: v.swr,
    retirementAge: v.retirementAge,
    lifeExpectancy: v.lifeExpectancy,
    emergencyMonths: v.emergencyMonths,
    fatMultiplier: v.fatMultiplier,
    withdrawalTaxRate: v.withdrawalTaxRate,
    retireAt: v.retireMode === "age" ? { mode: "age", age: v.retireAge ?? v.retirementAge } : { mode: "fi" },
    countGuaranteedIncome: v.countGuaranteedIncome,
    partTime:
      v.partTimeAnnual && v.partTimeAnnual > 0
        ? {
            annualNet: v.partTimeAnnual / 100,
            healthAnnual: (v.partTimeHealth ?? 0) / 100,
            ...(untilAge !== undefined ? { untilAge } : {}),
          }
        : undefined,
  });
  const debtPlan = DebtPlan.parse({
    ...prev.debtPlan,
    strategy: v.strategy,
    extraMonthly: (v.extraMonthly as number) / 100,
    hybridThreshold: v.hybridThreshold,
  });
  await updateScenario(ctx.db, ctx.scope, id, { assumptions, debtPlan, policy: v.policy });
  return { ok: true };
}

// ---------- retirement adjustments ----------

export const AdjustmentForm = z.object({
  label: z.string().trim().min(1, "Describe the change").max(80),
  annual: dollars({ allowNegative: true, max: 10_000_000 }),
  essential: checkbox,
  fromAge: z.string().optional(),
  untilAge: z.string().optional(),
});

function ageField(s: string | undefined): number | undefined | "bad" {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 120 ? n : "bad";
}

export async function addAdjustment(
  ctx: Ctx,
  id: string,
  input: Record<string, string>,
): Promise<ActionResult> {
  const row = await getScenario(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "Scenario not found" };
  const parsed = parseForm(AdjustmentForm, input);
  if ("result" in parsed) return parsed.result;
  const from = ageField(parsed.data.fromAge);
  const until = ageField(parsed.data.untilAge);
  if (from === "bad") return { ok: false, fieldErrors: { fromAge: "Enter an age or leave blank" } };
  if (until === "bad") return { ok: false, fieldErrors: { untilAge: "Enter an age or leave blank" } };
  const adj = SpendingAdjustment.parse({
    id: crypto.randomUUID(),
    label: parsed.data.label,
    annual: (parsed.data.annual as number) / 100,
    essential: parsed.data.essential,
    ...(from !== undefined ? { fromAge: from } : {}),
    ...(until !== undefined ? { untilAge: until } : {}),
  });
  const prev = readScenario(row);
  await updateScenario(ctx.db, ctx.scope, id, {
    retirementAdjustments: [...prev.retirementAdjustments, adj],
  });
  return { ok: true };
}

export async function removeAdjustment(ctx: Ctx, id: string, adjustmentId: string): Promise<ActionResult> {
  const row = await getScenario(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "Scenario not found" };
  const prev = readScenario(row);
  await updateScenario(ctx.db, ctx.scope, id, {
    retirementAdjustments: prev.retirementAdjustments.filter((a) => a.id !== adjustmentId),
  });
  return { ok: true };
}

// ---------- what-ifs ----------

export async function duplicateScenario(
  ctx: Ctx,
  id: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const row = await getScenario(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "Scenario not found" };
  const trimmed = name.trim().slice(0, 80) || `${row.name} (copy)`;
  const copy = await createScenario(ctx.db, ctx.scope, {
    name: trimmed,
    isBaseline: false,
    assumptions: row.assumptions,
    debtPlan: row.debtPlan,
    policy: row.policy,
    retirementAdjustments: row.retirementAdjustments,
    extraIncome: row.extraIncome,
    spendingOverrideCents: row.spendingOverrideCents,
  });
  return { ok: true, data: { id: copy.id } };
}

export async function renameScenario(ctx: Ctx, id: string, name: string): Promise<ActionResult> {
  const n = name.trim();
  if (!n) return { ok: false, fieldErrors: { name: "Enter a name" } };
  const row = await updateScenario(ctx.db, ctx.scope, id, { name: n.slice(0, 80) });
  return row ? { ok: true } : { ok: false, error: "Scenario not found" };
}

export async function removeScenario(ctx: Ctx, id: string): Promise<ActionResult> {
  return (await deleteScenario(ctx.db, ctx.scope, id))
    ? { ok: true }
    : { ok: false, error: "The baseline cannot be deleted" };
}

// ---------- debt plan (from the debt planner) ----------

export const DebtPlanForm = z.object({
  scenarioId: z.string().uuid(),
  strategy: z.enum(["avalanche", "snowball", "custom", "hybrid", "minimum"]),
  extraMonthly: dollars({ max: 1_000_000 }),
  customOrder: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
});

export async function saveDebtPlan(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = parseForm(DebtPlanForm, input);
  if ("result" in parsed) return parsed.result;
  const row = await getScenario(ctx.db, ctx.scope, parsed.data.scenarioId);
  if (!row) return { ok: false, error: "Scenario not found" };
  const prev = readScenario(row);
  const debtPlan = DebtPlan.parse({
    ...prev.debtPlan,
    strategy: parsed.data.strategy,
    extraMonthly: (parsed.data.extraMonthly as number) / 100,
    customOrder: parsed.data.customOrder.length ? parsed.data.customOrder : prev.debtPlan.customOrder,
  });
  await updateScenario(ctx.db, ctx.scope, row.id, { debtPlan });
  return { ok: true };
}
