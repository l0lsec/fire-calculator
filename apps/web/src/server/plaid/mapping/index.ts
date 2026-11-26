// Plaid -> domain mapping (BUILD_PLAN section 5 tables): account buckets,
// liabilities to debts, holdings with cost basis.
import type { HoldingValues, PlaidAccountValues, PlaidDebtFields } from "@fire/db";
import type { InvestmentsHoldingsGetResponse, LiabilitiesGetResponse, PlaidAccount } from "@fire/plaid";
import { escrowFromPayment } from "@fire/spending";

type Bucket = PlaidAccountValues["bucket"];

/**
 * Every investment subtype in Plaid's Account schema, mapped explicitly.
 * Source: plaid.com/docs/api/accounts, fetched 2026-11-25; every string here
 * appears in the page's verbatim accounts.subtype list. Unknown future
 * subtypes fall back to "taxable" (visible, never dropped).
 */
export const INVESTMENT_SUBTYPE_BUCKETS: Record<string, Bucket> = {
  "529": "excluded",
  "530a": "excluded",
  "401a": "traditional",
  "401k": "traditional",
  "403B": "traditional",
  "457b": "traditional",
  brokerage: "taxable",
  "cash isa": "taxable",
  "crypto exchange": "taxable",
  "education savings account": "excluded",
  fhsa: "excluded",
  "fixed annuity": "excluded",
  gic: "taxable",
  "health reimbursement arrangement": "excluded",
  hsa: "hsa",
  isa: "taxable",
  ira: "traditional",
  keogh: "traditional",
  lif: "traditional",
  "life insurance": "excluded",
  // Plaid lists it under investment; it is a liability, never an asset.
  "line of credit": "excluded",
  lira: "traditional",
  lrif: "traditional",
  lrsp: "traditional",
  "mutual fund": "taxable",
  "non-custodial wallet": "taxable",
  "non-taxable brokerage account": "taxable",
  other: "taxable",
  "other annuity": "excluded",
  "other insurance": "excluded",
  pension: "excluded",
  "prediction market": "taxable",
  prif: "traditional",
  "profit sharing plan": "traditional",
  qshr: "traditional",
  rdsp: "excluded",
  resp: "excluded",
  retirement: "traditional",
  rlif: "traditional",
  roth: "roth",
  "roth 401k": "roth",
  "roth 403B": "roth",
  "roth 457b": "roth",
  "roth pension": "excluded",
  "roth profit sharing plan": "roth",
  "roth thrift savings plan": "roth",
  rrif: "traditional",
  rrsp: "traditional",
  sarsep: "traditional",
  "sep ira": "traditional",
  "simple ira": "traditional",
  sipp: "traditional",
  "stock plan": "excluded",
  "thrift savings plan": "traditional",
  tfsa: "taxable",
  trust: "excluded",
  ugma: "excluded",
  utma: "excluded",
  "variable annuity": "excluded",
};

export class UnmappedSubtypeError extends Error {}

export function bucketFor(type: string, subtype: string | null): Bucket {
  if (type === "depository") return "cash";
  if (type === "credit" || type === "loan") return "excluded";
  if (type === "investment" || type === "brokerage") {
    const key = subtype ?? "other";
    const b = INVESTMENT_SUBTYPE_BUCKETS[key];
    if (!b) throw new UnmappedSubtypeError(`no bucket for investment subtype "${key}"`);
    return b;
  }
  return "excluded";
}

const cents = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100));

export function accountValues(a: PlaidAccount): PlaidAccountValues {
  let bucket: Bucket;
  try {
    bucket = bucketFor(a.type, a.subtype);
  } catch {
    // An unknown future subtype is treated as taxable and visible, never dropped.
    bucket = "taxable";
  }
  return {
    plaidAccountId: a.account_id,
    name: a.name,
    officialName: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    bucket,
    currentCents: cents(a.balances.current) ?? 0,
    availableCents: cents(a.balances.available),
    isoCurrency: a.balances.iso_currency_code ?? "USD",
  };
}

const KIND_BY_SUBTYPE: Record<string, PlaidDebtFields["kind"]> = {
  "credit card": "credit_card",
  paypal: "credit_card",
  mortgage: "mortgage",
  "home equity": "heloc",
  "home equity loan": "heloc",
  "line of credit": "heloc",
  student: "student",
  auto: "auto",
  consumer: "personal",
  loan: "personal",
  // business, commercial, commercial line of credit, construction, overdraft, other -> "other"
};

/** Debts implied by Plaid accounts and liabilities, keyed by Plaid account id. */
export function debtFieldsFrom(
  accounts: PlaidAccount[],
  liabilities: LiabilitiesGetResponse["liabilities"] | null,
  asOf: string,
): Map<string, PlaidDebtFields> {
  const out = new Map<string, PlaidDebtFields>();
  for (const a of accounts) {
    if (a.type !== "credit" && a.type !== "loan") continue;
    out.set(a.account_id, {
      name: a.name,
      kind: KIND_BY_SUBTYPE[a.subtype ?? ""] ?? "other",
      balanceCents: Math.max(0, cents(a.balances.current) ?? 0),
    });
  }
  if (!liabilities) return out;

  for (const c of liabilities.credit ?? []) {
    const f = c.account_id ? out.get(c.account_id) : undefined;
    if (!f) continue;
    const purchase = c.aprs.find((x) => x.apr_type === "purchase_apr") ?? c.aprs[0];
    // An empty aprs array means the issuer did not report one: leave the rate
    // unknown so the user is asked, never assume 0%.
    if (purchase) f.apr = purchase.apr_percentage / 100;
    f.minPaymentRule =
      c.minimum_payment_amount !== null
        ? { type: "card", floor: Math.min(35, c.minimum_payment_amount), pct: 0.01 }
        : { type: "card", floor: 35, pct: 0.01 };
  }
  for (const s of liabilities.student ?? []) {
    const f = s.account_id ? out.get(s.account_id) : undefined;
    if (!f) continue;
    f.apr = s.interest_rate_percentage / 100;
    if (s.minimum_payment_amount !== null)
      f.minPaymentRule = { type: "fixed", amount: s.minimum_payment_amount };
  }
  for (const l of liabilities.loan ?? []) {
    const f = out.get(l.account_id);
    if (!f) continue;
    if (l.interest_rate?.percentage !== null && l.interest_rate?.percentage !== undefined)
      f.apr = l.interest_rate.percentage / 100;
    if (l.next_payment_amount !== null && l.next_payment_amount !== undefined) {
      f.minPaymentRule = { type: "fixed", amount: l.next_payment_amount };
    }
    if (l.maturity_date) f.maturityDate = l.maturity_date;
  }
  for (const c of liabilities.line_of_credit ?? []) {
    const f = out.get(c.account_id);
    if (!f) continue;
    const pctRate = c.interest_rate?.percentage ?? c.aprs?.[0]?.apr_percentage ?? null;
    if (pctRate !== null) f.apr = pctRate / 100;
    if (c.minimum_payment_amount !== null && c.minimum_payment_amount !== undefined) {
      f.minPaymentRule = { type: "fixed", amount: c.minimum_payment_amount };
    }
  }
  for (const m of liabilities.mortgage ?? []) {
    const f = out.get(m.account_id);
    if (!f) continue;
    if (m.interest_rate.percentage !== null) f.apr = m.interest_rate.percentage / 100;
    if (m.maturity_date) f.maturityDate = m.maturity_date;
    if (m.next_monthly_payment !== null && m.interest_rate.percentage !== null && m.maturity_date) {
      const escrow = escrowFromPayment({
        monthlyPaymentCents: Math.round(m.next_monthly_payment * 100),
        balanceCents: f.balanceCents,
        apr: m.interest_rate.percentage / 100,
        asOf,
        maturityDate: m.maturity_date,
      });
      f.escrowMonthlyCents = escrow;
      // The debt engine pays principal and interest only; escrow is a living expense.
      f.minPaymentRule = { type: "fixed", amount: Math.round(m.next_monthly_payment * 100 - escrow) / 100 };
    } else if (m.next_monthly_payment !== null) {
      f.minPaymentRule = { type: "fixed", amount: m.next_monthly_payment };
    }
  }
  return out;
}

export function holdingsByAccount(res: InvestmentsHoldingsGetResponse): Map<string, HoldingValues[]> {
  const securities = new Map(res.securities.map((s) => [s.security_id, s]));
  const out = new Map<string, HoldingValues[]>();
  for (const h of res.holdings) {
    const s = securities.get(h.security_id);
    const list = out.get(h.account_id) ?? [];
    list.push({
      securityId: h.security_id,
      ticker: s?.ticker_symbol ?? null,
      name: s?.name ?? null,
      securityType: s?.type ?? null,
      quantity: h.quantity,
      valueCents: Math.round(h.institution_value * 100),
      costBasisCents: h.cost_basis === null ? null : Math.round(h.cost_basis * 100),
    });
    out.set(h.account_id, list);
  }
  return out;
}

/** Total cost basis for an account, or null when any holding lacks one. */
export function costBasisCents(holdings: HoldingValues[]): number | null {
  if (holdings.length === 0) return null;
  let sum = 0;
  for (const h of holdings) {
    if (h.costBasisCents === null) return null;
    sum += h.costBasisCents;
  }
  return sum;
}
