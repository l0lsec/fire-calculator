// Shapes plan and spending data into the rows the chart components draw. Pure and
// safe for client and server, so unit tests can prove each chart's numbers add up
// to the figures the rest of the app shows. Amounts come in as cents (spending,
// balances) or dollars (engine results) and always leave as dollars.
import { duration, monthName } from "./format";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" to "Mar 26". */
export function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${SHORT[m - 1] ?? ym} ${String(y).slice(2)}`;
}

const monthOf = (date: string) => date.slice(0, 7);
const dollars = (cents: number) => Math.round(cents) / 100;

// ---------- spending (from AnnualSpending.classified) ----------

/** The parts of a classified transaction the charts read (see @fire/spending Classified). */
export interface ClassifiedLike {
  tx: { date: string; amountCents: number };
  class: string;
  essential: boolean;
  category: string;
  countedCents: number;
}

const isLiving = (c: ClassifiedLike) => c.class === "living_expense" || c.class === "refund";

export interface SplitMonth {
  month: string;
  essential: number;
  discretionary: number;
}

/**
 * Living spending per month split into essential and discretionary. The two add
 * up to AnnualSpending.monthly for the same month (escrow is not in either).
 */
export function spendingSplitByMonth(classified: ClassifiedLike[], months: string[]): SplitMonth[] {
  const rows = new Map(months.map((m) => [m, { essential: 0, discretionary: 0 }]));
  for (const c of classified) {
    if (!isLiving(c)) continue;
    const r = rows.get(monthOf(c.tx.date));
    if (!r) continue;
    if (c.essential) r.essential += c.countedCents;
    else r.discretionary += c.countedCents;
  }
  return months.map((m) => {
    const r = rows.get(m)!;
    return { month: shortMonth(m), essential: dollars(r.essential), discretionary: dollars(r.discretionary) };
  });
}

export interface CategoryTrend {
  category: string;
  label: string;
  /** Total over the months shown (not annualized). */
  total: number;
  months: { month: string; value: number }[];
}

/** The `n` largest spending categories, each as a month-by-month series. */
export function categoryTrends(
  classified: ClassifiedLike[],
  months: string[],
  labelOf: (category: string) => string,
  n = 6,
): CategoryTrend[] {
  const index = new Map(months.map((m, i) => [m, i]));
  const byCat = new Map<string, number[]>();
  for (const c of classified) {
    if (!isLiving(c)) continue;
    const i = index.get(monthOf(c.tx.date));
    if (i === undefined) continue;
    const series = byCat.get(c.category) ?? months.map(() => 0);
    series[i] = (series[i] ?? 0) + c.countedCents;
    byCat.set(c.category, series);
  }
  return [...byCat]
    .map(([category, series]) => ({
      category,
      label: labelOf(category),
      total: dollars(series.reduce((s, v) => s + v, 0)),
      months: series.map((v, i) => ({ month: shortMonth(months[i]!), value: dollars(v) })),
    }))
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export interface InOutMonth {
  month: string;
  income: number;
  spending: number;
}

/** Money coming in (income) and living spending, month by month. */
export function moneyInOut(classified: ClassifiedLike[], months: string[]): InOutMonth[] {
  const rows = new Map(months.map((m) => [m, { income: 0, spending: 0 }]));
  for (const c of classified) {
    const r = rows.get(monthOf(c.tx.date));
    if (!r) continue;
    // Income posts as a negative amount (money in).
    if (c.class === "income") r.income -= c.tx.amountCents;
    else if (isLiving(c)) r.spending += c.countedCents;
  }
  return months.map((m) => {
    const r = rows.get(m)!;
    return { month: shortMonth(m), income: dollars(r.income), spending: dollars(r.spending) };
  });
}

// ---------- balances over time ----------

export interface SnapshotLike {
  accountId: string;
  asOfDate: string;
  currentCents: number;
}

export interface AccountLike {
  id: string;
  type: string;
  bucket: string;
  includeInFi: boolean;
}

export interface BalancePoint {
  date: string;
  netWorthCents: number;
  /** Balances of the accounts counted toward FI (before any emergency reserve). */
  countedCents: number;
}

const isDebt = (a: AccountLike | undefined) => a?.type === "credit" || a?.type === "loan";
const countsTowardFi = (a: AccountLike | undefined) =>
  a !== undefined && !isDebt(a) && a.includeInFi && a.bucket !== "excluded";

/**
 * Net worth and the money counted toward FI on every day with a balance. Each
 * account's last known balance carries forward, so a gap does not look like a loss.
 */
export function balanceHistory(snaps: SnapshotLike[], accounts: AccountLike[]): BalancePoint[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byDate = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    const m = byDate.get(s.asOfDate) ?? new Map<string, number>();
    m.set(s.accountId, s.currentCents);
    byDate.set(s.asOfDate, m);
  }
  const last = new Map<string, number>();
  const out: BalancePoint[] = [];
  for (const date of [...byDate.keys()].sort()) {
    for (const [id, c] of byDate.get(date)!) last.set(id, c);
    let net = 0;
    let counted = 0;
    for (const [id, c] of last) {
      const a = byId.get(id);
      net += isDebt(a) ? -c : c;
      if (countsTowardFi(a)) counted += c;
    }
    out.push({ date, netWorthCents: net, countedCents: counted });
  }
  return out;
}

// ---------- scenarios ----------

export interface ScenarioLike {
  name: string;
  ready: boolean;
  fiTarget: number | null;
  startMonth: number | null;
  months: { fi: number | null };
}

export interface ScenarioBar {
  name: string;
  value: number;
  /** What the bar's end says: a month ("Mar 2041") or a dollar figure. */
  text: string;
}

/**
 * Two bar series for comparing scenarios: years until FI (labelled with the month)
 * and the FI number. A scenario that is not set up, or never reaches FI within the
 * plan, has no bar and is listed in `missing` with the reason.
 */
export function scenarioBars(summaries: ScenarioLike[]): {
  fiDate: ScenarioBar[];
  fiNumber: ScenarioBar[];
  missing: { name: string; reason: string }[];
} {
  const fiDate: ScenarioBar[] = [];
  const fiNumber: ScenarioBar[] = [];
  const missing: { name: string; reason: string }[] = [];
  for (const s of summaries) {
    if (!s.ready) {
      missing.push({ name: s.name, reason: "needs setup" });
      continue;
    }
    if (s.fiTarget !== null) fiNumber.push({ name: s.name, value: s.fiTarget, text: "" });
    const m = s.months.fi;
    if (m === null) missing.push({ name: s.name, reason: "FI not within the plan" });
    else
      fiDate.push({
        name: s.name,
        value: Math.round((m / 12) * 10) / 10,
        text: m === 0 ? "reached" : `${monthName((s.startMonth ?? 0) + m)}, in ${duration(m)}`,
      });
  }
  return { fiDate, fiNumber, missing };
}

// ---------- debts ----------

export interface DebtMonthLike {
  k: number;
  totalPayment: number;
  totalInterest: number;
}

// A type, not an interface, so the rows fit the charts' Record-shaped props.
export type PaymentSplit = {
  label: string;
  interest: number;
  principal: number;
};

/**
 * Each payment split into interest and principal. Up to `monthlyUpTo` months it is
 * one bar a month; a longer schedule is summed by calendar year so the bars stay
 * readable. Interest plus principal is the total paid in that period.
 */
export function paymentSplit(
  schedule: DebtMonthLike[],
  startMonth: number,
  monthlyUpTo = 36,
): { per: "month" | "year"; rows: PaymentSplit[] } {
  const round = (v: number) => Math.round(v * 100) / 100;
  const split = (r: DebtMonthLike) => ({
    interest: r.totalInterest,
    principal: Math.max(0, r.totalPayment - r.totalInterest),
  });
  if (schedule.length <= monthlyUpTo) {
    return {
      per: "month",
      rows: schedule.map((r) => {
        const s = split(r);
        return {
          label: monthName(startMonth + r.k),
          interest: round(s.interest),
          principal: round(s.principal),
        };
      }),
    };
  }
  const years = new Map<number, { interest: number; principal: number }>();
  for (const r of schedule) {
    const year = Math.floor((startMonth + r.k) / 12);
    const y = years.get(year) ?? { interest: 0, principal: 0 };
    const s = split(r);
    y.interest += s.interest;
    y.principal += s.principal;
    years.set(year, y);
  }
  return {
    per: "year",
    rows: [...years].map(([year, y]) => ({
      label: String(year),
      interest: round(y.interest),
      principal: round(y.principal),
    })),
  };
}
