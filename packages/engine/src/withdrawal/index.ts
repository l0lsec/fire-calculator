// Withdrawal access and taxes (BUILD_PLAN section 8, T4.1).
//
// Reaching FI at 45 with everything in a 401(k) is not usable FI: traditional
// money is penalized before 59.5. The accessibility check walks the bridge from
// the FI month to 59.5 month by month, paying retirement spending from money
// that is reachable without penalty:
//   - cash and taxable accounts;
//   - Roth contribution basis (contributions come out tax and penalty free);
//   - Roth conversion ladder: traditional money converted each year becomes
//     reachable 5 years (60 months) after its conversion;
//   - Rule of 55: traditional money in the plan of an employer left in or after
//     the year you turn 55 is reachable from separation (modeled for the whole
//     traditional bucket when enabled and the FI age is 55 or more).
// It reports the first year after FI from which every month is covered.
import { retirementSpendingAt } from "../cashflow";
import { type Account, type EngineInput, monthAtAge, monthlyRate, realRate } from "../core";
import type { PlanResult } from "../levels";

export interface LadderPlan {
  /** Annual conversion from traditional to Roth, today's dollars. */
  annualConversion: number;
}

export interface AccessOptions {
  ladder?: LadderPlan;
  ruleOf55?: boolean;
}

export interface AccessResult {
  applies: boolean;
  fiAge: number | null;
  /** Years from FI to 59.5. */
  gapYears: number;
  /** Accessible at the FI month (today's dollars). */
  accessibleAtFI: number;
  /** First whole year after FI from which every month is covered without penalty; null if never before 59.5. */
  coveredFromYear: number | null;
  /** Months in the bridge that could not be covered. */
  uncoveredMonths: number;
  ok: boolean;
}

/**
 * Walks the bridge in today's dollars at the real return. `startPortfolio` is
 * the bucket split at the FI month (today's dollars).
 */
export function bridgeCoverage(
  input: EngineInput,
  fiK: number,
  buckets: { cash: number; taxable: number; traditional: number; roth: number; hsa: number },
  rothBasis: number,
  opts: AccessOptions = {},
): AccessResult {
  const p = input.people[0];
  if (!p)
    return {
      applies: false,
      fiAge: null,
      gapYears: 0,
      accessibleAtFI: 0,
      coveredFromYear: 0,
      uncoveredMonths: 0,
      ok: true,
    };
  const fiMonth = input.startMonth + fiK;
  const fiAge = (fiMonth - p.birthMonth) / 12;
  const end = monthAtAge(p, 59.5);
  const gapMonths = Math.max(0, end - fiMonth);
  if (gapMonths === 0) {
    return {
      applies: false,
      fiAge,
      gapYears: 0,
      accessibleAtFI: 0,
      coveredFromYear: 0,
      uncoveredMonths: 0,
      ok: true,
    };
  }

  const m = monthlyRate(realRate(input.assumptions.nominalReturn, input.assumptions.inflation));
  const rule55 = Boolean(opts.ruleOf55) && fiAge >= 55;
  let open = buckets.cash + buckets.taxable + Math.min(rothBasis, buckets.roth);
  let traditional = buckets.traditional;
  if (rule55) {
    open += traditional;
    traditional = 0;
  }
  const accessibleAtFI = open;
  // Conversions in flight: [monthAvailable, amount].
  const seasoning: { at: number; amount: number }[] = [];
  const conversion = opts.ladder?.annualConversion ?? 0;
  const tax = input.assumptions.withdrawalTaxRate;

  let lastUncovered = -1;
  let uncovered = 0;
  for (let j = 0; j < gapMonths; j++) {
    // Convert once a year (at the start of each FI year).
    if (conversion > 0 && j % 12 === 0 && traditional > 0) {
      const amt = Math.min(conversion, traditional);
      traditional -= amt;
      seasoning.push({ at: j + 60, amount: amt });
    }
    for (let i = seasoning.length - 1; i >= 0; i--) {
      const s = seasoning[i]!;
      if (j >= s.at) {
        open += s.amount;
        seasoning.splice(i, 1);
      }
    }
    open *= 1 + m;
    traditional *= 1 + m;
    for (const s of seasoning) s.amount *= 1 + m;

    const age = (fiMonth + j - p.birthMonth) / 12;
    const need = retirementSpendingAt(input, age).total / 12 / (1 - tax);
    if (open >= need) open -= need;
    else {
      uncovered++;
      lastUncovered = j;
      open = 0;
    }
  }
  const coveredFromMonth = lastUncovered + 1;
  return {
    applies: true,
    fiAge,
    gapYears: gapMonths / 12,
    accessibleAtFI,
    coveredFromYear:
      lastUncovered < 0 ? 0 : coveredFromMonth < gapMonths ? Math.ceil(coveredFromMonth / 12) : null,
    uncoveredMonths: uncovered,
    ok: uncovered === 0,
  };
}

/** The accessibility check for a plan's FI month, using its accumulation path. */
export function accessibleFI(result: PlanResult, opts: AccessOptions = {}): AccessResult {
  const input = result.input;
  if (result.fiK === null) {
    return {
      applies: false,
      fiAge: null,
      gapYears: 0,
      accessibleAtFI: 0,
      coveredFromYear: null,
      uncoveredMonths: 0,
      ok: false,
    };
  }
  const row = result.accumulation.rows[result.fiK]!;
  const d = row.deflator;
  const rothBasis = input.accounts
    .filter((a) => a.bucket === "roth" && a.includeInFI)
    .reduce((s, a) => s + (a.rothContributionBasis ?? 0), 0);
  return bridgeCoverage(
    input,
    result.fiK,
    {
      cash: Math.max(0, row.buckets.cash - row.reserve) / d,
      taxable: row.buckets.taxable / d,
      traditional: row.buckets.traditional / d,
      roth: row.buckets.roth / d,
      hsa: row.buckets.hsa / d,
    },
    rothBasis,
    opts,
  );
}

export interface TaxRates {
  /** Marginal ordinary rate expected in retirement (traditional withdrawals). */
  ordinary: number;
  /** Long-term capital gains rate (gains share of taxable withdrawals). */
  capitalGains: number;
}

export const DEFAULT_TAX_RATES: TaxRates = { ordinary: 0.12, capitalGains: 0.15 };

/**
 * Effective tax on a withdrawal spread across buckets by balance: traditional
 * at the ordinary rate, taxable at the gains rate times its unrealized-gain
 * share (from cost basis), cash, Roth and HSA (for medical use) untaxed.
 */
export function blendedWithdrawalTax(
  accounts: readonly Account[],
  rates: TaxRates = DEFAULT_TAX_RATES,
): number {
  let total = 0;
  let taxed = 0;
  for (const a of accounts) {
    if (!a.includeInFI || a.bucket === "excluded" || a.balance <= 0) continue;
    total += a.balance;
    if (a.bucket === "traditional") taxed += a.balance * rates.ordinary;
    if (a.bucket === "taxable") {
      const gainShare = a.costBasis === undefined ? 0.5 : Math.max(0, 1 - a.costBasis / a.balance);
      taxed += a.balance * gainShare * rates.capitalGains;
    }
  }
  return total > 0 ? taxed / total : 0;
}
