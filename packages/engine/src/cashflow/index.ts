// Time-varying cash flows (BUILD_PLAN sections 6 and 9).
//
// Every stream is stated in today's dollars and paid at the END of the month it
// falls in, in that month-end's prices: month k (1-based) uses the growth factor
// at k / 12 years. This is the convention under which a nominal run deflated by
// cumulative inflation equals a run in real terms exactly (T1.4 G1).
//
// Escrow (property tax, homeowners insurance) is taken from mortgage debts and
// treated as a permanent essential expense: it continues after the loan's
// principal and interest stop. Spending figures passed in therefore EXCLUDE
// escrow and all debt payments.
import type { ContributionStream, EngineInput, IncomeStream, InvestableBucket, Person } from "../core";
import { ageAt } from "../core";

export type GrowthKind = "raise" | "inflation" | "none";

export function growthFactor(input: EngineInput, growth: GrowthKind, k: number): number {
  const years = Math.max(0, k) / 12;
  switch (growth) {
    case "raise":
      return (1 + input.assumptions.raiseRate) ** years;
    case "inflation":
      return (1 + input.assumptions.inflation) ** years;
    case "none":
      return 1;
  }
}

export function primary(input: EngineInput): Person {
  const p = input.people[0];
  if (!p) throw new Error("engine input has no people");
  return p;
}

function personFor(input: EngineInput, id: string): Person {
  return input.people.find((p) => p.id === id) ?? primary(input);
}

/** Age of the primary person during month k (1-based; k = 0 is the start). */
export function ageAtK(input: EngineInput, k: number, person: Person = primary(input)): number {
  return ageAt(person, input.startMonth + Math.max(0, k - 1));
}

function inWindow(age: number, from?: number, until?: number): boolean {
  if (from !== undefined && age < from - 1e-9) return false;
  if (until !== undefined && age >= until - 1e-9) return false;
  return true;
}

export function streamActive(input: EngineInput, s: IncomeStream, k: number, retired: boolean): boolean {
  if (s.phase === "working" && retired) return false;
  if (s.phase === "retired" && !retired) return false;
  return inWindow(ageAtK(input, k, personFor(input, s.personId)), s.startAge, s.endAge);
}

const GUARANTEED = new Set<IncomeStream["kind"]>(["socialSecurity", "pension"]);

export function escrowMonthly(input: EngineInput): number {
  return input.debts.reduce((a, d) => a + d.escrowMonthly, 0);
}

/** Retirement spending at a given age of the primary person, annual, today's dollars. */
export function retirementSpendingAt(input: EngineInput, age: number): { total: number; essential: number } {
  const escrowAnnual = escrowMonthly(input) * 12;
  let total = input.spending.currentAnnual + escrowAnnual;
  let essential = input.spending.currentEssentialAnnual + escrowAnnual;
  for (const adj of activeAdjustments(input, age)) {
    total += adj.annual;
    if (adj.essential) essential += adj.annual;
  }
  return { total: Math.max(0, total), essential: Math.max(0, Math.min(essential, Math.max(0, total))) };
}

/** The retirement adjustments that apply at an age of the primary person (what retirementSpendingAt adds). */
export function activeAdjustments(
  input: EngineInput,
  age: number,
): EngineInput["spending"]["retirementAdjustments"] {
  return input.spending.retirementAdjustments.filter((adj) => inWindow(age, adj.fromAge, adj.untilAge));
}

/** Guaranteed income (Social Security, pensions) active at an age, annual, today's dollars. */
export function guaranteedIncomeAt(input: EngineInput, age: number): number {
  let total = 0;
  for (const s of input.income) {
    if (!GUARANTEED.has(s.kind) || s.phase === "working") continue;
    const person = personFor(input, s.personId);
    // Express the stream owner's window in terms of the primary person's age.
    const ownerAge = age + (primary(input).birthMonth - person.birthMonth) / 12;
    if (inWindow(ownerAge, s.startAge, s.endAge)) total += s.monthly * 12;
  }
  return total;
}

export interface MonthFlows {
  /** All income received this month, nominal. */
  income: number;
  /** Social Security and pensions within `income`. */
  guaranteedIncome: number;
  /** Pre-tax payroll contributions by bucket (working only), nominal. */
  contributions: Partial<Record<InvestableBucket, number>>;
  contributionTotal: number;
  /** Living expenses, excluding debt payments; includes escrow. Nominal. */
  livingExpenses: number;
  essentialExpenses: number;
  escrow: number;
}

/**
 * Cash flows for month k. `priceLevel` is the cumulative price index at the end
 * of month k; it defaults to the constant inflation assumption and is supplied
 * by the projection when a return path carries realized inflation (historical
 * or Monte Carlo runs), so inflation-linked amounts follow actual prices.
 */
export function flowsAt(input: EngineInput, k: number, retired: boolean, priceLevel?: number): MonthFlows {
  const grow = (g: GrowthKind) =>
    g === "inflation" && priceLevel !== undefined ? priceLevel : growthFactor(input, g, k);
  let income = 0;
  let guaranteedIncome = 0;
  for (const s of input.income) {
    if (!streamActive(input, s, k, retired)) continue;
    const amt = s.monthly * grow(s.growth);
    income += amt;
    if (GUARANTEED.has(s.kind)) guaranteedIncome += amt;
  }

  const contributions: Partial<Record<InvestableBucket, number>> = {};
  let contributionTotal = 0;
  if (!retired) {
    for (const c of input.contributions as ContributionStream[]) {
      const amt = c.monthly * grow(c.growth);
      contributions[c.bucket] = (contributions[c.bucket] ?? 0) + amt;
      contributionTotal += amt;
    }
  }

  const infl = grow("inflation");
  const escrow = escrowMonthly(input) * infl;
  let livingExpenses: number;
  let essentialExpenses: number;
  if (retired) {
    const r = retirementSpendingAt(input, ageAtK(input, k));
    livingExpenses = (r.total / 12) * infl;
    essentialExpenses = (r.essential / 12) * infl;
  } else {
    livingExpenses = (input.spending.currentAnnual / 12) * infl + escrow;
    essentialExpenses = (input.spending.currentEssentialAnnual / 12) * infl + escrow;
  }

  return {
    income,
    guaranteedIncome,
    contributions,
    contributionTotal,
    livingExpenses,
    essentialExpenses,
    escrow,
  };
}
