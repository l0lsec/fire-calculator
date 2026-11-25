// Debt amortization and payoff strategies (BUILD_PLAN section 7).
//
// Each month, in order:
//   1. interest accrues on every open debt at its effective APR / 12
//      (card issuers use average daily balance; monthly accrual is within a few
//      dollars and is the documented approximation);
//   2. every open debt receives its minimum payment;
//   3. the rest of the fixed monthly budget (initial minimums + extra) goes to
//      the strategy's target order; minimums freed by payoffs roll over because
//      the budget never shrinks.
// "minimum" pays minimums only: no extra and no rollover.
import type { Debt, DebtPlan, EngineWarning, MonthIndex, Strategy } from "../core";

/** A balance at or below half a cent is treated as paid off. */
export const PAID_EPSILON = 0.005;
export const MAX_DEBT_MONTHS = 600;

export interface DebtMonth {
  /** Months elapsed, 1-based: the month this row describes. */
  k: number;
  balances: Record<string, number>;
  interest: Record<string, number>;
  payments: Record<string, number>;
  totalPayment: number;
  totalInterest: number;
}

export interface DebtResult {
  strategy: Strategy;
  /** Fixed monthly debt budget (0 for "minimum", which has no fixed budget). */
  budget: number;
  /** Months until every debt is paid (or the cap, if not repaid). */
  months: number;
  paidOff: boolean;
  totalInterest: number;
  /** Months elapsed when each debt hit zero; null if never within the cap. */
  payoffMonth: Record<string, number | null>;
  /** Debt ids in the order they were paid off. */
  payoffOrder: string[];
  schedule: DebtMonth[];
  initialBalances: Record<string, number>;
  warnings: EngineWarning[];
}

export function effectiveApr(debt: Debt, month: MonthIndex): number {
  return debt.promo && month < debt.promo.endsMonth ? debt.promo.apr : debt.apr;
}

/** Minimum due this month, given the balance before and after interest accrual. */
export function minimumDue(debt: Debt, balanceBefore: number, interest: number): number {
  const owed = balanceBefore + interest;
  const rule = debt.minPayment;
  const due = rule.type === "fixed" ? rule.amount : Math.max(rule.floor, rule.pct * balanceBefore + interest);
  return Math.min(due, owed);
}

interface Live {
  debt: Debt;
  balance: number;
}

function orderFor(strategy: Strategy, plan: DebtPlan, month: MonthIndex) {
  const avalanche = (a: Live, b: Live) =>
    effectiveApr(b.debt, month) - effectiveApr(a.debt, month) ||
    a.balance - b.balance ||
    a.debt.id.localeCompare(b.debt.id);
  switch (strategy) {
    case "avalanche":
    case "hybrid":
      return avalanche;
    case "snowball":
      return (a: Live, b: Live) =>
        a.balance - b.balance ||
        effectiveApr(b.debt, month) - effectiveApr(a.debt, month) ||
        a.debt.id.localeCompare(b.debt.id);
    case "custom": {
      const rank = (l: Live) => {
        const i = plan.customOrder.indexOf(l.debt.id);
        return i < 0 ? Number.POSITIVE_INFINITY : i;
      };
      return (a: Live, b: Live) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return avalanche(a, b);
      };
    }
    case "minimum":
      return avalanche;
  }
}

export interface SimulateOptions {
  startMonth: MonthIndex;
  maxMonths?: number;
}

export function simulateDebts(debts: readonly Debt[], plan: DebtPlan, opts: SimulateOptions): DebtResult {
  const maxMonths = opts.maxMonths ?? MAX_DEBT_MONTHS;
  const strategy = plan.strategy;
  const live: Live[] = debts
    .filter((d) => d.balance > PAID_EPSILON)
    .map((d) => ({ debt: d, balance: d.balance }));
  const warnings: EngineWarning[] = [];
  const initialBalances = Object.fromEntries(debts.map((d) => [d.id, d.balance]));
  const payoffMonth: Record<string, number | null> = Object.fromEntries(
    debts.map((d) => [d.id, d.balance > PAID_EPSILON ? null : 0]),
  );
  const payoffOrder: string[] = [];

  // Fixed budget: the first month's minimums plus the extra.
  let budget = 0;
  if (strategy !== "minimum") {
    for (const l of live) {
      const i = (l.balance * effectiveApr(l.debt, opts.startMonth)) / 12;
      budget += minimumDue(l.debt, l.balance, i);
    }
    budget += plan.extraMonthly;
  }

  for (const l of live) {
    const i = (l.balance * effectiveApr(l.debt, opts.startMonth)) / 12;
    const due = minimumDue(l.debt, l.balance, i);
    if (due < i - 1e-9) {
      warnings.push({
        code: "negative-amortization",
        message: `${l.debt.name}: minimum payment ${due.toFixed(2)} is below monthly interest ${i.toFixed(2)}`,
        ref: l.debt.id,
      });
    }
  }

  const schedule: DebtMonth[] = [];
  let totalInterest = 0;
  let k = 0;
  const open = () => live.filter((l) => l.balance > PAID_EPSILON);

  while (open().length > 0 && k < maxMonths) {
    k += 1;
    const month = opts.startMonth + k - 1;
    const interest: Record<string, number> = {};
    const payments: Record<string, number> = {};
    const before: Record<string, number> = {};
    let monthInterest = 0;

    for (const l of open()) {
      before[l.debt.id] = l.balance;
      const i = (l.balance * effectiveApr(l.debt, month)) / 12;
      l.balance += i;
      interest[l.debt.id] = i;
      monthInterest += i;
    }

    let avail = budget;
    for (const l of open()) {
      const due = minimumDue(l.debt, before[l.debt.id] ?? 0, interest[l.debt.id] ?? 0);
      const pay = Math.min(due, l.balance);
      l.balance -= pay;
      payments[l.debt.id] = pay;
      avail -= pay;
    }

    if (strategy !== "minimum" && avail > 0) {
      let targets = open().sort(orderFor(strategy, plan, month));
      if (strategy === "hybrid")
        targets = targets.filter((l) => effectiveApr(l.debt, month) > plan.hybridThreshold);
      for (const l of targets) {
        if (avail <= 0) break;
        const pay = Math.min(avail, l.balance);
        l.balance -= pay;
        payments[l.debt.id] = (payments[l.debt.id] ?? 0) + pay;
        avail -= pay;
      }
    }

    const balances: Record<string, number> = {};
    for (const l of live) {
      if (l.balance <= PAID_EPSILON && payoffMonth[l.debt.id] === null) {
        payoffMonth[l.debt.id] = k;
        payoffOrder.push(l.debt.id);
      }
      balances[l.debt.id] = l.balance <= PAID_EPSILON ? 0 : l.balance;
    }
    totalInterest += monthInterest;
    schedule.push({
      k,
      balances,
      interest,
      payments,
      totalPayment: Object.values(payments).reduce((a, b) => a + b, 0),
      totalInterest: monthInterest,
    });
  }

  const paidOff = open().length === 0;
  if (!paidOff) {
    for (const l of open()) {
      warnings.push({
        code: "debt-not-repaid",
        message: `${l.debt.name} is not repaid within ${maxMonths} months under ${strategy}`,
        ref: l.debt.id,
      });
    }
  }

  return {
    strategy,
    budget,
    months: k,
    paidOff,
    totalInterest,
    payoffMonth,
    payoffOrder,
    schedule,
    initialBalances,
    warnings,
  };
}

/** Balance of each debt after k months (k = 0 is the starting balance). */
export function balancesAt(result: DebtResult, k: number): Record<string, number> {
  if (k <= 0) return { ...result.initialBalances };
  const row = result.schedule[Math.min(k, result.schedule.length) - 1];
  if (!row) return { ...result.initialBalances };
  // Past the end of a repaid schedule every balance is zero.
  if (k > result.schedule.length && result.paidOff) {
    return Object.fromEntries(Object.keys(result.initialBalances).map((id) => [id, 0]));
  }
  return { ...result.initialBalances, ...row.balances };
}

export function totalBalanceAt(result: DebtResult, k: number, filter?: (id: string) => boolean): number {
  const b = balancesAt(result, k);
  return Object.entries(b)
    .filter(([id]) => (filter ? filter(id) : true))
    .reduce((a, [, v]) => a + v, 0);
}

/** Total debt payment made in month k (1-based); zero before start or after payoff. */
export function paymentAt(result: DebtResult, k: number): number {
  return result.schedule[k - 1]?.totalPayment ?? 0;
}

export interface StrategyComparison {
  results: Record<Strategy, DebtResult>;
  /** Interest saved by each strategy against paying minimums only. */
  interestSaved: Record<Strategy, number>;
}

export function compareStrategies(
  debts: readonly Debt[],
  plan: DebtPlan,
  opts: SimulateOptions,
): StrategyComparison {
  const all: Strategy[] = ["avalanche", "snowball", "custom", "hybrid", "minimum"];
  const results = Object.fromEntries(
    all.map((s) => [s, simulateDebts(debts, { ...plan, strategy: s }, opts)]),
  ) as Record<Strategy, DebtResult>;
  const base = results.minimum.totalInterest;
  const interestSaved = Object.fromEntries(all.map((s) => [s, base - results[s].totalInterest])) as Record<
    Strategy,
    number
  >;
  return { results, interestSaved };
}

/** Month (elapsed) at which no debt above `aprThreshold` remains; 0 if none at start. */
export function monthWhenNoDebtAbove(
  result: DebtResult,
  debts: readonly Debt[],
  aprThreshold: number,
): number | null {
  let latest = 0;
  for (const d of debts) {
    if (d.apr <= aprThreshold) continue;
    const m = result.payoffMonth[d.id];
    if (m === null || m === undefined) return null;
    latest = Math.max(latest, m);
  }
  return latest;
}

export function monthWhenDebtFree(
  result: DebtResult,
  debts: readonly Debt[],
  include: (d: Debt) => boolean,
): number | null {
  let latest = 0;
  for (const d of debts) {
    if (!include(d)) continue;
    const m = result.payoffMonth[d.id];
    if (m === null || m === undefined) return null;
    latest = Math.max(latest, m);
  }
  return latest;
}
