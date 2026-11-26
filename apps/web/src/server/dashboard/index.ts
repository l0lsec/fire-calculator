// Turns a household plan into a serializable dashboard model (BUILD_PLAN section 11).

import { retirementSpendingAt } from "@fire/engine/cashflow";
import type { EngineWarning } from "@fire/engine/core";
import { targetsAt } from "@fire/engine/levels";
import { fiPortfolio, netWorth, real } from "@fire/engine/projection";
import { accessibleFI, blendedWithdrawalTax } from "@fire/engine/withdrawal";
import { monthName } from "@/lib/format";
import type { HouseholdPlan, SnapshotIssue } from "../snapshot";

export type LadderStatus = "reached" | "projected" | "not-within-plan";

export interface LadderRow {
  id: string;
  label: string;
  isDebt: boolean;
  target: number;
  current: number;
  progress: number;
  status: LadderStatus;
  when: string | null;
  age: number | null;
}

export interface ChartPoint {
  k: number;
  label: string;
  age: number;
  portfolio: number;
  fi: number;
  lean: number;
  fat: number;
  coast: number;
  retired: boolean;
}

export interface DashboardModel {
  scenarioName: string;
  ready: boolean;
  issues: SnapshotIssue[];
  headline: {
    fiTarget: number;
    spendingPart: number;
    debtPart: number;
    fiWhen: string | null;
    fiAge: number | null;
    fiMonths: number | null;
    portfolio: number;
    netWorth: number;
    savingsRate: number | null;
    spendingAnnual: number;
    retirementSpending: number;
    spendingSource: "manual" | "plaid";
  } | null;
  ladder: LadderRow[];
  chart: ChartPoint[];
  retireLabel: string | null;
  chips: { label: string; value: string }[];
  warnings: EngineWarning[];
  /** Pre-59.5 accessibility of the FI portfolio (null when FI is at or after 59.5, or not reached). */
  access: {
    gapYears: number;
    accessibleAtFI: number;
    coveredFromYear: number | null;
    ladderFromYear: number | null;
  } | null;
  /** Blended withdrawal tax implied by the account mix, versus the assumption. */
  tax: { suggested: number; assumed: number };
}

const POLICY: Record<string, string> = {
  payoffAtFI: "pay off at FI",
  keepMortgage: "keep mortgage",
  debtFreeFirst: "debt-free first",
};

export function dashboardModel(plan: HouseholdPlan): DashboardModel {
  const s = plan.scenario;
  const a = s.assumptions;
  const chips = [
    { label: "Return", value: `${(a.nominalReturn * 100).toFixed(1)}%` },
    { label: "Inflation", value: `${(a.inflation * 100).toFixed(1)}%` },
    { label: "Withdrawal rate", value: `${(a.swr * 100).toFixed(2).replace(/0$/, "")}%` },
    { label: "Withdrawal tax", value: `${Math.round(a.withdrawalTaxRate * 100)}%` },
    { label: "Coast to age", value: String(a.retirementAge) },
    { label: "Debt", value: POLICY[s.policy] ?? s.policy },
  ];
  if (!plan.input || !plan.result) {
    return {
      scenarioName: s.name,
      ready: false,
      issues: plan.issues,
      headline: null,
      ladder: [],
      chart: [],
      retireLabel: null,
      chips,
      warnings: [],
      access: null,
      tax: { suggested: 0, assumed: a.withdrawalTaxRate },
    };
  }
  const input = plan.input;
  const r = plan.result;
  const acc = r.accumulation;
  const row0 = acc.rows[0]!;
  const t0 = r.levels;
  const fiRow = r.fiK !== null ? acc.rows[r.fiK] : undefined;

  // First-year savings rate on the accumulation path.
  let income = 0;
  let contrib = 0;
  let living = 0;
  let interest = 0;
  for (let k = 1; k <= 12 && k < acc.rows.length; k++) {
    const row = acc.rows[k]!;
    income += row.income;
    contrib += row.contributions;
    living += row.livingExpenses;
    interest += acc.debt.schedule[k - 1]?.totalInterest ?? 0;
  }
  const gross = income + contrib;
  const savingsRate = gross > 0 ? (gross - living - interest) / gross : null;

  const ladder: LadderRow[] = r.ladder.map((l) => ({
    id: l.id,
    label: l.label,
    isDebt: ["highInterestDebtFree", "consumerDebtFree", "debtFree"].includes(l.id),
    target: l.target,
    current: l.current,
    progress: l.progress,
    status: l.reachedK === 0 ? "reached" : l.reachedK === null ? "not-within-plan" : "projected",
    when: l.reachedMonth !== null ? monthName(l.reachedMonth) : null,
    age: l.reachedAge,
  }));

  const step = Math.max(1, Math.round(r.plan.rows.length / 160));
  const chart: ChartPoint[] = [];
  for (let k = 0; k < r.plan.rows.length; k += step) {
    const row = r.plan.rows[k]!;
    const accRow = acc.rows[k] ?? acc.rows[acc.rows.length - 1]!;
    const t = targetsAt(input, acc, accRow);
    chart.push({
      k,
      label: monthName(input.startMonth + k),
      age: Math.round(row.age * 10) / 10,
      portfolio: Math.max(0, Math.round(real(row, fiPortfolio(row)))),
      fi: Math.round(t.fi),
      lean: Math.round(t.lean),
      fat: Math.round(t.fat),
      coast: Math.round(t.coast),
      retired: row.retired,
    });
  }

  const retireLabel = r.plan.retiredAtK !== null ? monthName(input.startMonth + r.plan.retiredAtK) : null;
  const spendingNow =
    input.spending.currentAnnual + input.debts.reduce((x, d) => x + d.escrowMonthly * 12, 0);
  const retirementSpending = retirementSpendingAt(input, fiRow?.age ?? row0.age).total;

  const acc0 = accessibleFI(r);
  let access: DashboardModel["access"] = null;
  if (acc0.applies && !acc0.ok) {
    // What a ladder converting a year of spending would do.
    const yearly = (retirementSpending / (1 - a.withdrawalTaxRate)) * 1.1;
    const withLadder = accessibleFI(r, { ladder: { annualConversion: yearly } });
    access = {
      gapYears: acc0.gapYears,
      accessibleAtFI: acc0.accessibleAtFI,
      coveredFromYear: acc0.coveredFromYear,
      ladderFromYear: withLadder.coveredFromYear,
    };
  }
  const tax = { suggested: blendedWithdrawalTax(input.accounts), assumed: a.withdrawalTaxRate };

  return {
    scenarioName: s.name,
    ready: true,
    access,
    tax,
    issues: plan.issues,
    headline: {
      fiTarget: t0.fi,
      spendingPart: t0.fi - t0.debt,
      debtPart: t0.debt,
      fiWhen: r.fiK !== null ? monthName(input.startMonth + r.fiK) : null,
      fiAge: fiRow ? fiRow.age : null,
      fiMonths: r.fiK,
      portfolio: real(row0, fiPortfolio(row0)),
      netWorth: netWorth(row0),
      savingsRate,
      spendingAnnual: spendingNow,
      retirementSpending,
      spendingSource: plan.data.spendingSource,
    },
    ladder,
    chart,
    retireLabel,
    chips,
    warnings: r.warnings,
  };
}
