// Scenario comparison and invest-vs-prepay (BUILD_PLAN section 7, T4.3).
import type { Db, HouseholdScope } from "@fire/db";
import type { EngineInput } from "@fire/engine/core";
import { type PlanResult, runPlan } from "@fire/engine/levels";
import { monteCarlo } from "@fire/engine/risk";
import { planForScenario, type SnapshotIssue } from "../snapshot";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const COMPARE_LEVELS = [
  "coast",
  "lean",
  "barista",
  "fi",
  "fat",
  "consumerDebtFree",
  "debtFree",
] as const;
export type CompareLevel = (typeof COMPARE_LEVELS)[number];

export interface ScenarioSummary {
  id: string;
  name: string;
  isBaseline: boolean;
  ready: boolean;
  issues: SnapshotIssue[];
  fiTarget: number | null;
  /** Months until each level on the accumulation path (null: not within the plan or not set up). */
  months: Record<CompareLevel, number | null>;
  totalInterest: number | null;
  successRate: number | null;
  startMonth: number | null;
}

export interface Comparison {
  summaries: ScenarioSummary[];
  /** Per scenario after the first: differences against the first (months, dollars, rate points). */
  deltas: {
    id: string;
    months: Record<CompareLevel, number | null>;
    fiTarget: number | null;
    totalInterest: number | null;
    successRate: number | null;
  }[];
}

export function summarize(
  id: string,
  name: string,
  isBaseline: boolean,
  input: EngineInput | null,
  result: PlanResult | null,
  issues: SnapshotIssue[],
  opts: { mcRuns?: number } = {},
): ScenarioSummary {
  const months = Object.fromEntries(COMPARE_LEVELS.map((l) => [l, null])) as Record<
    CompareLevel,
    number | null
  >;
  if (!input || !result) {
    return {
      id,
      name,
      isBaseline,
      ready: false,
      issues,
      fiTarget: null,
      months,
      totalInterest: null,
      successRate: null,
      startMonth: null,
    };
  }
  for (const item of result.ladder) {
    if ((COMPARE_LEVELS as readonly string[]).includes(item.id))
      months[item.id as CompareLevel] = item.reachedK;
  }
  const runs = opts.mcRuns ?? 200;
  const successRate =
    runs > 0
      ? monteCarlo(input, { runs, seed: 20261125, ...(result.fiK !== null ? { retireAtK: result.fiK } : {}) })
          .successRate
      : null;
  return {
    id,
    name,
    isBaseline,
    ready: true,
    issues,
    fiTarget: result.levels.fi,
    months,
    totalInterest: result.accumulation.debt.totalInterest,
    successRate,
    startMonth: input.startMonth,
  };
}

const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);

export function deltas(summaries: ScenarioSummary[]): Comparison["deltas"] {
  const [base, ...rest] = summaries;
  if (!base) return [];
  return rest.map((s) => ({
    id: s.id,
    months: Object.fromEntries(COMPARE_LEVELS.map((l) => [l, diff(base.months[l], s.months[l])])) as Record<
      CompareLevel,
      number | null
    >,
    fiTarget: diff(base.fiTarget, s.fiTarget),
    totalInterest: diff(base.totalInterest, s.totalInterest),
    successRate: diff(base.successRate, s.successRate),
  }));
}

export async function compareScenarios(
  ctx: Ctx,
  ids: string[],
  asOf?: string,
  opts: { mcRuns?: number } = {},
): Promise<Comparison> {
  const summaries: ScenarioSummary[] = [];
  for (const id of ids.slice(0, 4)) {
    const p = await planForScenario(ctx, id, asOf);
    summaries.push(
      summarize(p.scenario.id, p.scenario.name, p.scenario.isBaseline, p.input, p.result, p.issues, opts),
    );
  }
  return { summaries, deltas: deltas(summaries) };
}

export interface PrepayOutcome {
  fiMonths: number | null;
  debtFreeMonths: number | null;
  totalInterest: number;
}

export interface InvestVsPrepay {
  debtId: string;
  extraMonthly: number;
  apr: number;
  /** Extra dollars go to this debt first. */
  prepay: PrepayOutcome;
  /** The same dollars stay invested (the household's surplus is invested by default). */
  invest: PrepayOutcome;
  /** Positive: prepaying reaches FI sooner by this many months. */
  fiMonthsSaved: number | null;
}

function outcome(r: PlanResult, debtId: string): PrepayOutcome {
  return {
    fiMonths: r.fiK,
    debtFreeMonths: r.accumulation.debt.payoffMonth[debtId] ?? null,
    totalInterest: r.accumulation.debt.totalInterest,
  };
}

/**
 * Prepay: the scenario's extra payment plus `extraMonthly`, aimed at this debt
 * first. Invest: the scenario as is, so those dollars remain surplus and are
 * invested. Both draw from the same income, so the comparison is fair.
 */
export function investVsPrepay(input: EngineInput, debtId: string, extraMonthly: number): InvestVsPrepay {
  const debt = input.debts.find((d) => d.id === debtId);
  if (!debt) throw new Error("debt not found");
  const prepayInput: EngineInput = {
    ...input,
    debtPlan: {
      ...input.debtPlan,
      strategy: "custom",
      customOrder: [debtId, ...input.debtPlan.customOrder.filter((x) => x !== debtId)],
      extraMonthly: input.debtPlan.extraMonthly + extraMonthly,
    },
  };
  const prepay = outcome(runPlan(prepayInput), debtId);
  const invest = outcome(runPlan(input), debtId);
  return {
    debtId,
    extraMonthly,
    apr: debt.apr,
    prepay,
    invest,
    fiMonthsSaved:
      invest.fiMonths !== null && prepay.fiMonths !== null ? invest.fiMonths - prepay.fiMonths : null,
  };
}
