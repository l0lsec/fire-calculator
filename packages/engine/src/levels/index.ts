// FI levels, the FI ladder and debt-at-FI policies (BUILD_PLAN sections 7 and 8).
//
// Every target is in today's dollars at a given projection row:
//   spending part:  max(0, E - G) / w * g      (g = 1 / (1 - withdrawal tax))
//   debt part D(t): policy-dependent, see debtTerm()
// E is retirement spending at that age, G the guaranteed income counted at that
// age (only when assumptions.countGuaranteedIncome), w the withdrawal rate.
// Dates come from the accumulation path (keep working, keep contributing).
import { guaranteedIncomeAt, retirementSpendingAt } from "../cashflow";
import {
  annuityPV,
  type Debt,
  type EngineInput,
  type EngineWarning,
  type MonthIndex,
  monthAtAge,
  monthlyRate,
  realRate,
} from "../core";
import { balancesAt, monthWhenDebtFree, monthWhenNoDebtAbove } from "../debt";
import { fiPortfolio, type MonthRow, type Projection, project, real } from "../projection";

export interface Targets {
  lean: number;
  fi: number;
  fat: number;
  barista: number;
  half: number;
  coast: number;
  /** The debt term D(t) inside every target. */
  debt: number;
}

export type LevelId =
  | "emergency"
  | "highInterestDebtFree"
  | "consumerDebtFree"
  | "coast"
  | "halfFI"
  | "lean"
  | "barista"
  | "fi"
  | "fat"
  | "debtFree";

export interface LadderItem {
  id: LevelId;
  label: string;
  /** Target at the start, today's dollars (0 for debt milestones). */
  target: number;
  /** Current value at the start, today's dollars. */
  current: number;
  /** 0..1 at the start. */
  progress: number;
  /** Elapsed months until reached on the accumulation path; 0 if already met; null if not within the horizon. */
  reachedK: number | null;
  reachedMonth: MonthIndex | null;
  reachedAge: number | null;
}

export interface PlanResult {
  input: EngineInput;
  /** Keep-working path, used for every ladder date. */
  accumulation: Projection;
  /** The plan as configured (retire at FI or at an age). */
  plan: Projection;
  /** Targets at the start, today's dollars. */
  levels: Targets;
  ladder: LadderItem[];
  fiK: number | null;
  warnings: EngineWarning[];
}

const isMortgage = (d: Debt) => d.kind === "mortgage";

function gross(input: EngineInput): number {
  return 1 / (1 - input.assumptions.withdrawalTaxRate);
}

function spendNeed(input: EngineInput, age: number, annual: number): number {
  const g = input.assumptions.countGuaranteedIncome ? guaranteedIncomeAt(input, age) : 0;
  return (Math.max(0, annual - g) / input.assumptions.swr) * gross(input);
}

/** Months for a fixed payment to retire a balance at monthly rate r (Infinity if it never does). */
function monthsToRepay(balance: number, payment: number, r: number): number {
  if (balance <= 0) return 0;
  if (payment <= 0) return Number.POSITIVE_INFINITY;
  if (r <= 0) return balance / payment;
  if (payment <= balance * r) return Number.POSITIVE_INFINITY;
  return -Math.log(1 - (balance * r) / payment) / Math.log(1 + r);
}

/**
 * D(t) in today's dollars.
 * payoffAtFI / debtFreeFirst: every outstanding balance.
 * keepMortgage: non-mortgage balances plus the PV of the remaining mortgage
 * minimum payments at the expected portfolio return (optimistic).
 */
export function debtTerm(input: EngineInput, acc: Projection, row: MonthRow): number {
  if (input.policy !== "keepMortgage") return real(row, row.debtBalance);
  const balances = balancesAt(acc.debt, row.k);
  const iMonthly = monthlyRate(input.assumptions.nominalReturn);
  let nominal = 0;
  for (const d of input.debts) {
    const bal = balances[d.id] ?? 0;
    if (bal <= 0.005) continue;
    if (!isMortgage(d) || d.minPayment.type !== "fixed") {
      nominal += bal;
      continue;
    }
    const n = monthsToRepay(bal, d.minPayment.amount, d.apr / 12);
    nominal += Number.isFinite(n) ? Math.min(bal, annuityPV(d.minPayment.amount, iMonthly, n)) : bal;
  }
  return real(row, nominal);
}

function rowAtK(p: Projection, k: number): MonthRow {
  const last = p.rows[p.rows.length - 1];
  const row = p.rows[Math.max(0, Math.min(k, p.rows.length - 1))] ?? last;
  if (!row) throw new Error("projection has no rows");
  return row;
}

/** Bridged Barista FI: the portfolio at `row` that, withdrawing the gap until `untilAge`, reaches FI then. */
function baristaBridged(input: EngineInput, acc: Projection, row: MonthRow, untilAge: number): number {
  const p = input.people[0];
  if (!p) return 0;
  const pt = input.assumptions.partTime;
  if (!pt) return 0;
  const endK = monthAtAge(p, untilAge) - input.startMonth;
  const n = Math.max(0, endK - row.k);
  const atEnd = rowAtK(acc, endK);
  const fiAtEnd =
    spendNeed(input, untilAge, retirementSpendingAt(input, untilAge).total) + debtTerm(input, acc, atEnd);
  if (n === 0) return fiAtEnd;
  const m = monthlyRate(realRate(input.assumptions.nominalReturn, input.assumptions.inflation));
  const spend = retirementSpendingAt(input, row.age).total;
  const g = input.assumptions.countGuaranteedIncome ? guaranteedIncomeAt(input, row.age) : 0;
  const q = ((spend + pt.healthAnnual - pt.annualNet - g) * gross(input)) / 12;
  const growth = (1 + m) ** n;
  const annuity = Math.abs(m) < 1e-12 ? n : (growth - 1) / m;
  return (fiAtEnd + q * annuity) / growth;
}

/** Every level's target at a projection row of the accumulation path. */
export function targetsAt(input: EngineInput, acc: Projection, row: MonthRow): Targets {
  const a = input.assumptions;
  const spend = retirementSpendingAt(input, row.age);
  const D = debtTerm(input, acc, row);
  const fi = spendNeed(input, row.age, spend.total) + D;
  const lean = spendNeed(input, row.age, spend.essential) + D;
  const fatAnnual = a.fatAnnual ?? spend.total * a.fatMultiplier;
  const fat = spendNeed(input, row.age, fatAnnual) + D;

  let barista = fi;
  if (a.partTime) {
    barista =
      a.partTime.untilAge !== undefined && a.partTime.untilAge > row.age
        ? baristaBridged(input, acc, row, a.partTime.untilAge)
        : spendNeed(input, row.age, spend.total + a.partTime.healthAnnual - a.partTime.annualNet) + D;
  }

  // Coast: the FI target at the traditional retirement age, discounted at the real return.
  let coast = fi;
  const p = input.people[0];
  if (p && row.age < a.retirementAge) {
    const retK = monthAtAge(p, a.retirementAge) - input.startMonth;
    const atRet = rowAtK(acc, retK);
    const fiAtRet =
      spendNeed(input, a.retirementAge, retirementSpendingAt(input, a.retirementAge).total) +
      debtTerm(input, acc, atRet);
    const r = realRate(a.nominalReturn, a.inflation);
    coast = fiAtRet / (1 + r) ** (a.retirementAge - row.age);
  }

  return { lean, fi, fat, barista, half: fi * 0.5, coast, debt: D };
}

function nonMortgageBalanceAt(input: EngineInput, acc: Projection, k: number): number {
  const b = balancesAt(acc.debt, k);
  return input.debts.filter((d) => !isMortgage(d)).reduce((s, d) => s + (b[d.id] ?? 0), 0);
}

type ValueLevel = "coast" | "half" | "lean" | "barista" | "fi" | "fat";

function firstReach(input: EngineInput, acc: Projection, level: ValueLevel): number | null {
  for (const row of acc.rows) {
    if (input.policy === "debtFreeFirst" && nonMortgageBalanceAt(input, acc, row.k) > 0.005) continue;
    const t = targetsAt(input, acc, row)[level];
    if (real(row, fiPortfolio(row)) >= t - 1e-6) return row.k;
  }
  return null;
}

/** Elapsed months until the plan's FI target is met on the accumulation path. */
export function fiMonth(
  input: EngineInput,
  acc: Projection = project(input, { neverRetire: true }),
): number | null {
  return firstReach(input, acc, "fi");
}

function when(input: EngineInput, k: number | null, acc: Projection) {
  if (k === null) return { reachedK: null, reachedMonth: null, reachedAge: null };
  return { reachedK: k, reachedMonth: input.startMonth + k, reachedAge: rowAtK(acc, k).age };
}

export function buildLadder(input: EngineInput, acc: Projection): LadderItem[] {
  const row0 = rowAtK(acc, 0);
  const t0 = targetsAt(input, acc, row0);
  const portfolio0 = real(row0, fiPortfolio(row0));
  const items: LadderItem[] = [];
  const value = (id: LevelId, label: string, level: ValueLevel, target: number) => {
    items.push({
      id,
      label,
      target,
      current: portfolio0,
      progress: target > 0 ? Math.min(1, portfolio0 / target) : 1,
      ...when(input, firstReach(input, acc, level), acc),
    });
  };
  const debtItem = (id: LevelId, label: string, initial: number, k: number | null) => {
    items.push({
      id,
      label,
      target: 0,
      current: initial,
      progress: initial > 0 ? 0 : 1,
      ...when(input, k, acc),
    });
  };

  // 1. Emergency fund.
  let emergencyK: number | null = null;
  for (const row of acc.rows) {
    if (row.buckets.cash >= row.reserve - 1e-6) {
      emergencyK = row.k;
      break;
    }
  }
  const reserve0 = real(row0, row0.reserve);
  items.push({
    id: "emergency",
    label: `Emergency fund (${input.assumptions.emergencyMonths} months of essentials)`,
    target: reserve0,
    current: row0.buckets.cash,
    progress: reserve0 > 0 ? Math.min(1, row0.buckets.cash / reserve0) : 1,
    ...when(input, emergencyK, acc),
  });

  // 2-3. Debt milestones.
  const threshold = input.debtPlan.hybridThreshold;
  const high = input.debts.filter((d) => d.apr > threshold).reduce((s, d) => s + d.balance, 0);
  debtItem(
    "highInterestDebtFree",
    `No debt above ${(threshold * 100).toFixed(0)}% APR`,
    high,
    monthWhenNoDebtAbove(acc.debt, input.debts, threshold),
  );
  const consumer = input.debts.filter((d) => !isMortgage(d)).reduce((s, d) => s + d.balance, 0);
  debtItem(
    "consumerDebtFree",
    "Consumer debt free",
    consumer,
    monthWhenDebtFree(acc.debt, input.debts, (d) => !isMortgage(d)),
  );

  // 4-9. Portfolio levels.
  value("coast", "Coast FI", "coast", t0.coast);
  value("halfFI", "Half FI", "half", t0.half);
  value("lean", "Lean FI", "lean", t0.lean);
  if (input.assumptions.partTime) value("barista", "Barista FI", "barista", t0.barista);
  value("fi", "FI", "fi", t0.fi);
  value("fat", "Fat FI", "fat", t0.fat);

  // 10. Fully debt free.
  const all = input.debts.reduce((s, d) => s + d.balance, 0);
  debtItem(
    "debtFree",
    "Fully debt free, including the mortgage",
    all,
    monthWhenDebtFree(acc.debt, input.debts, () => true),
  );

  return items;
}

/** The whole plan: accumulation path, FI date, plan path, ladder and warnings. */
export function runPlan(input: EngineInput): PlanResult {
  const accumulation = project(input, { neverRetire: true });
  const fiK = fiMonth(input, accumulation);
  const mode = input.assumptions.retireAt.mode;
  const plan =
    mode === "fi" ? (fiK === null ? accumulation : project(input, { retireAtK: fiK })) : project(input);
  const ladder = buildLadder(input, accumulation);
  const warnings: EngineWarning[] = [...accumulation.warnings];
  for (const w of plan.warnings) if (!warnings.some((x) => x.code === w.code)) warnings.push(w);

  if (fiK !== null) {
    const row = rowAtK(accumulation, fiK);
    const total = fiPortfolio(row);
    if (row.age < 59.5 && total > 0 && row.buckets.traditional / total > 0.5) {
      warnings.push({
        code: "fi-before-59-5-traditional-heavy",
        message: `FI arrives at ${row.age.toFixed(1)}, but most of the portfolio is in traditional accounts that are hard to reach before 59.5.`,
        month: input.startMonth + fiK,
      });
    }
  }

  return {
    input,
    accumulation,
    plan,
    levels: targetsAt(input, accumulation, rowAtK(accumulation, 0)),
    ladder,
    fiK,
    warnings,
  };
}
