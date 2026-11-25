// Monthly projection (BUILD_PLAN section 9).
//
// Nominal dollars inside, today's dollars out. Each month k (1-based):
//   1. every bucket grows at its monthly rate;
//   2. working: pre-tax contributions land in their buckets; take-home income
//      minus living expenses minus debt payments is the surplus, which fills the
//      emergency reserve first (if enabled) and then follows the allocation; a
//      deficit draws buckets down in withdrawal order;
//   3. retired: spending plus kept-debt payments, net of retirement income, is
//      withdrawn in withdrawal order, grossed up for the effective withdrawal tax.
// At the retirement transition the debt policy applies: "payoffAtFI" and
// "debtFreeFirst" retire every balance from the portfolio; "keepMortgage" pays
// off everything except mortgages, which continue at their minimum payment.

import { flowsAt } from "../cashflow";
import {
  ageAt,
  type EngineInput,
  type EngineWarning,
  INVESTABLE_BUCKETS,
  type InvestableBucket,
  type MonthIndex,
  monthAtAge,
  monthlyRate,
} from "../core";
import { type DebtResult, paymentAt, simulateDebts, totalBalanceAt } from "../debt";

export type Buckets = Record<InvestableBucket, number>;

export interface ReturnPath {
  /** Monthly nominal return on invested buckets, indexed by k - 1. */
  invested: readonly number[];
  /** Monthly inflation, indexed by k - 1. */
  inflation: readonly number[];
  /** Monthly nominal return on cash, indexed by k - 1 (defaults to the assumption). */
  cash?: readonly number[];
}

export interface ProjectionOptions {
  /** Keep working for the whole horizon (the path the FI ladder dates use). */
  neverRetire?: boolean;
  /** Retire after this many elapsed months (overrides assumptions.retireAt). */
  retireAtK?: number;
  /** Stochastic or historical returns; defaults to the constant assumptions. */
  path?: ReturnPath;
  horizonMonths?: number;
}

export interface MonthRow {
  k: number;
  month: MonthIndex;
  age: number;
  retired: boolean;
  /** End-of-month balances, nominal. */
  buckets: Buckets;
  /** Assets outside the FI portfolio (excluded accounts), nominal, held flat. */
  excluded: number;
  debtBalance: number;
  mortgageBalance: number;
  /** Emergency reserve the household keeps in cash, nominal. */
  reserve: number;
  income: number;
  contributions: number;
  livingExpenses: number;
  debtPayment: number;
  /** Working surplus (negative: deficit) or retirement net need (negative: excess income). */
  surplus: number;
  withdrawals: number;
  /** Price level relative to the start. */
  deflator: number;
}

export interface Projection {
  rows: MonthRow[];
  debt: DebtResult;
  /** Elapsed month after which the household is retired, or null. */
  retiredAtK: number | null;
  depletedAtK: number | null;
  warnings: EngineWarning[];
}

export const MAX_HORIZON = 1200;

/** Age of the primary person at the END of elapsed month k (the row's state). */
export function endAge(input: EngineInput, k: number): number {
  const p = input.people[0];
  return p ? ageAt(p, input.startMonth + k) : 0;
}

export function horizonFor(input: EngineInput): number {
  const p = input.people[0];
  if (!p) return 0;
  const end = monthAtAge(p, input.assumptions.lifeExpectancy);
  return Math.max(1, Math.min(MAX_HORIZON, end - input.startMonth));
}

export function invested(b: Buckets): number {
  return b.taxable + b.traditional + b.roth + b.hsa;
}

/** The portfolio that counts toward FI: invested buckets plus cash above the reserve. */
export function fiPortfolio(row: MonthRow): number {
  return invested(row.buckets) + Math.max(0, row.buckets.cash - row.reserve);
}

export function netWorth(row: MonthRow): number {
  return INVESTABLE_BUCKETS.reduce((a, b) => a + row.buckets[b], 0) + row.excluded - row.debtBalance;
}

export function real(row: MonthRow, nominal: number): number {
  return nominal / row.deflator;
}

function startingBuckets(input: EngineInput): { buckets: Buckets; excluded: number } {
  const buckets: Buckets = { cash: 0, taxable: 0, traditional: 0, roth: 0, hsa: 0 };
  let excluded = 0;
  for (const a of input.accounts) {
    if (a.bucket === "excluded" || !a.includeInFI) excluded += a.balance;
    else buckets[a.bucket] += a.balance;
  }
  return { buckets, excluded };
}

/** Withdraw `amount` from buckets in order; returns the shortfall left unpaid. */
function withdraw(b: Buckets, order: readonly InvestableBucket[], amount: number): number {
  let need = amount;
  for (const key of order) {
    if (need <= 0) break;
    const take = Math.min(b[key], need);
    b[key] -= take;
    need -= take;
  }
  // Anything not named in the order is a last resort.
  for (const key of INVESTABLE_BUCKETS) {
    if (need <= 0) break;
    const take = Math.min(b[key], need);
    b[key] -= take;
    need -= take;
  }
  return Math.max(0, need);
}

function retireK(input: EngineInput, opts: ProjectionOptions): number | null {
  if (opts.neverRetire) return null;
  if (opts.retireAtK !== undefined) return Math.max(0, opts.retireAtK);
  const r = input.assumptions.retireAt;
  if (r.mode === "age") {
    const p = input.people[0];
    if (!p) return null;
    return Math.max(0, monthAtAge(p, r.age) - input.startMonth);
  }
  // mode "fi" needs the FI target; levels.planProjection resolves it.
  return null;
}

export function project(input: EngineInput, opts: ProjectionOptions = {}): Projection {
  const a = input.assumptions;
  const horizon = Math.min(opts.horizonMonths ?? horizonFor(input), MAX_HORIZON);
  const warnings: EngineWarning[] = [];
  const debt = simulateDebts(input.debts, input.debtPlan, {
    startMonth: input.startMonth,
    maxMonths: horizon,
  });
  warnings.push(...debt.warnings);

  const isMortgage = new Set(input.debts.filter((d) => d.kind === "mortgage").map((d) => d.id));
  const retireAt = retireK(input, opts);
  const order = a.withdrawalOrder;
  const investedMonthly = monthlyRate(a.nominalReturn);
  const cashMonthly = monthlyRate(a.cashReturn);
  const inflMonthly = monthlyRate(a.inflation);

  const { buckets, excluded } = startingBuckets(input);
  const flows0 = flowsAt(input, 0, false);
  const reserveFor = (essentialMonthly: number) => a.emergencyMonths * essentialMonthly;

  const rows: MonthRow[] = [
    {
      k: 0,
      month: input.startMonth,
      age: endAge(input, 0),
      retired: retireAt === 0,
      buckets: { ...buckets },
      excluded,
      debtBalance: totalBalanceAt(debt, 0),
      mortgageBalance: totalBalanceAt(debt, 0, (id) => isMortgage.has(id)),
      reserve: reserveFor(flows0.essentialExpenses),
      income: 0,
      contributions: 0,
      livingExpenses: 0,
      debtPayment: 0,
      surplus: 0,
      withdrawals: 0,
      deflator: 1,
    },
  ];

  // After retirement, kept debts follow their own minimum-only schedule.
  let keptDebt: DebtResult | null = null;
  let keptFrom = 0;
  let deflator = 1;
  let depletedAtK: number | null = null;
  let warnedDeficit = false;

  for (let k = 1; k <= horizon; k++) {
    const retired = retireAt !== null && k > retireAt;
    const prev = rows[k - 1]!;
    const rInv = opts.path?.invested[k - 1] ?? investedMonthly;
    const rCash = opts.path?.cash?.[k - 1] ?? cashMonthly;
    const infl = opts.path?.inflation[k - 1] ?? inflMonthly;
    deflator *= 1 + infl;

    const b: Buckets = { ...prev.buckets };
    b.cash *= 1 + rCash;
    b.taxable *= 1 + rInv;
    b.traditional *= 1 + rInv;
    b.roth *= 1 + rInv;
    b.hsa *= 1 + rInv;

    // Retirement transition: apply the debt policy once, at the first retired month.
    if (retired && keptDebt === null) {
      keptFrom = k - 1;
      const remaining = input.debts
        .map((d) => ({ d, bal: totalBalanceAt(debt, k - 1, (id) => id === d.id) }))
        .filter((x) => x.bal > 0.005);
      const keep = input.policy === "keepMortgage" ? remaining.filter((x) => isMortgage.has(x.d.id)) : [];
      const payNow = remaining.filter((x) => !keep.includes(x));
      const lump = payNow.reduce((s, x) => s + x.bal, 0);
      if (lump > 0) {
        const short = withdraw(b, order, lump);
        if (short > 0 && depletedAtK === null) depletedAtK = k;
      }
      keptDebt = simulateDebts(
        keep.map((x) => ({ ...x.d, balance: x.bal })),
        { ...input.debtPlan, strategy: "minimum", extraMonthly: 0 },
        { startMonth: input.startMonth + k - 1, maxMonths: Math.max(1, horizon - k + 1) },
      );
    }

    const f = flowsAt(input, k, retired);
    const reserve = reserveFor(f.essentialExpenses);
    let debtPayment: number;
    let debtBalance: number;
    let mortgageBalance: number;
    if (retired && keptDebt) {
      debtPayment = paymentAt(keptDebt, k - keptFrom);
      debtBalance = totalBalanceAt(keptDebt, k - keptFrom);
      mortgageBalance = debtBalance;
    } else {
      debtPayment = paymentAt(debt, k);
      debtBalance = totalBalanceAt(debt, k);
      mortgageBalance = totalBalanceAt(debt, k, (id) => isMortgage.has(id));
    }

    let surplus: number;
    let withdrawals = 0;
    if (!retired) {
      for (const key of INVESTABLE_BUCKETS) b[key] += f.contributions[key] ?? 0;
      surplus = f.income - f.livingExpenses - debtPayment;
      if (surplus >= 0) {
        let left = surplus;
        if (a.fillEmergencyFirst && b.cash < reserve) {
          const top = Math.min(left, reserve - b.cash);
          b.cash += top;
          left -= top;
        }
        for (const key of INVESTABLE_BUCKETS) b[key] += left * a.allocation[key];
      } else {
        withdrawals = -surplus;
        const short = withdraw(b, order, -surplus);
        if (!warnedDeficit) {
          warnings.push({
            code: "deficit",
            message: "Spending and debt payments exceed income; savings are being drawn down.",
            month: input.startMonth + k - 1,
          });
          warnedDeficit = true;
        }
        if (short > 0 && depletedAtK === null) depletedAtK = k;
      }
    } else {
      const need = f.livingExpenses + debtPayment - f.income;
      surplus = need;
      if (need > 0) {
        withdrawals = need / (1 - a.withdrawalTaxRate);
        const short = withdraw(b, order, withdrawals);
        if (short > 0 && depletedAtK === null) depletedAtK = k;
      } else {
        b.taxable += -need;
      }
    }

    rows.push({
      k,
      month: input.startMonth + k,
      age: endAge(input, k),
      retired,
      buckets: b,
      excluded,
      debtBalance,
      mortgageBalance,
      reserve,
      income: f.income,
      contributions: f.contributionTotal,
      livingExpenses: f.livingExpenses,
      debtPayment,
      surplus,
      withdrawals,
      deflator,
    });
  }

  if (depletedAtK !== null) {
    warnings.push({
      code: "portfolio-depleted",
      message: "The portfolio runs out before the end of the plan.",
      month: input.startMonth + depletedAtK,
    });
  }
  if (horizon < horizonFor(input)) {
    warnings.push({ code: "horizon-capped", message: `Projection capped at ${horizon} months.` });
  }

  return { rows, debt, retiredAtK: retireAt, depletedAtK, warnings };
}

/** First elapsed month whose FI portfolio (today's dollars) meets `target(row)`. */
export function firstMonthReaching(
  rows: readonly MonthRow[],
  target: (row: MonthRow) => number,
): number | null {
  for (const row of rows) if (real(row, fiPortfolio(row)) >= target(row) - 1e-9) return row.k;
  return null;
}
