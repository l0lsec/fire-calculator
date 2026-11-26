// Cash-flow forecast and "safe to spend". Pure: accounts, classified
// transactions and a cushion in, a day-by-day forecast out.
//
// For each cash account the repeating money movements on it (bills, card
// payments, transfers, paychecks) are found from its own history and laid out
// over the next 30 days. Safe to spend is the lowest point of the spending
// accounts' combined path, less the cushion: money that can go out today and
// still leave every bill paid and the cushion intact until money comes in.
// It is deliberately cautious: pay counts only once it has repeated three
// times, a pay deposit that is late is not assumed, a bill that is late is
// assumed due today, and a variable bill is assumed at its higher recent amount.
import type { Classified, SpendingTx } from "./index";
import { advance, type Cadence, detectSeries, merchantKey, type RecurringSeries } from "./recurring";

export interface CashAccount {
  id: string;
  name: string;
  mask: string | null;
  /** Plaid account type and subtype: only depository accounts hold spendable cash. */
  type: string;
  subtype: string | null;
  business: boolean;
  /** Available balance when the bank gives one (it already reflects pending charges), else current. */
  balanceCents: number;
}

export type FlowKind = "income" | "bill" | "card-payment" | "transfer" | "subscription" | "other";

export interface CashFlowItem {
  key: string;
  seriesKey: string;
  accountId: string;
  name: string;
  date: string;
  /** Signed for cash: positive is money in, negative is money out. */
  deltaCents: number;
  kind: FlowKind;
  cadence: Cadence;
  confidence: "likely" | "confirmed";
  /** Was due before today and has not posted yet. */
  late: boolean;
  /** Set when the user added this bill by hand (its scheduled bill id). */
  scheduledId?: string;
}

/** A bill the user knows is coming that the history cannot show yet. */
export interface ScheduledBill {
  id: string;
  accountId: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  /** The due date as entered; earlier dates are assumed paid and later ones follow the cadence. */
  nextDate: string;
}

export interface ForecastDay {
  date: string;
  /** Balance at the end of the day with only the scheduled items. */
  committedCents: number;
  /** Lowest point of the day: after its money out, before its money in. */
  lowCents: number;
  /** End of day if day-to-day spending also carries on at the usual pace. */
  paceCents: number;
}

export interface AccountForecast {
  account: CashAccount;
  role: "spending" | "savings" | "business";
  startCents: number;
  items: CashFlowItem[];
  days: ForecastDay[];
  low: { date: string; cents: number };
  /** Usual day-to-day spending from this account, per day (last 90 days, scheduled items left out). */
  paceDailyCents: number;
  /** First day the scheduled items alone take the balance below zero. */
  shortfall: {
    date: string;
    /** That first day's low point, and the item that took it below zero. */
    cents: number;
    cause: string | null;
    /** The deepest point before money brings it back (can be later and lower). */
    worstCents: number;
    worstDate: string;
  } | null;
}

export interface TransferSuggestion {
  fromAccountId: string;
  toAccountId: string;
  cents: number;
  byDate: string;
}

export interface Spendable {
  accountIds: string[];
  startCents: number;
  days: ForecastDay[];
  low: { date: string; cents: number };
  /** What can go out before the next payday at the daily allowance (never more than maxTodayCents). */
  safeToSpendCents: number;
  /** The most that could go out today in one go without dipping under the cushion later. */
  maxTodayCents: number;
  nextPayday: { date: string; cents: number; name: string } | null;
  /** Days from today to the next payday, or to the end of the forecast without one. */
  daysToPayday: number;
  /**
   * The daily allowance: spending this much every day keeps the spending
   * accounts at or above the cushion for the whole forecast, bills after
   * payday included.
   */
  perDayCents: number;
  /** Money going out before the next payday (or in the window without one). */
  billsBeforePaydayCents: number;
  paceDailyCents: number;
  /** First day the usual pace of spending would take the spending accounts below zero. */
  paceRunsOut: string | null;
}

export interface CashForecast {
  asOf: string;
  horizonDays: number;
  cushionCents: number;
  accounts: AccountForecast[];
  /** The personal spending accounts together; null when there are none. */
  spendable: Spendable | null;
  /** The spending accounts' scheduled items in order, with their combined balance after each. */
  upcoming: (CashFlowItem & { balanceAfterCents: number })[];
  transfers: TransferSuggestion[];
  /** Overdraft, returned-payment and late fees in the last 12 months. */
  feesCents: number;
}

const DAY = 86_400_000;
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;
const iso = (n: number) => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
const STEP: Record<Cadence, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
const SAVINGS = /savings|money market|cd|hsa/i;
const FEE_DETAILED = new Set([
  "BANK_FEES_OVERDRAFT_FEES",
  "BANK_FEES_INSUFFICIENT_FUNDS",
  "BANK_FEES_LATE_FEES",
]);
const FEE_NAME = /OVERDRAFT|\bNSF\b|INSUFFICIENT FUNDS|RETURNED ITEM FEE|LATE FEE/i;

export function accountRole(a: CashAccount): AccountForecast["role"] | null {
  if (a.type !== "depository") return null;
  if (a.business) return "business";
  return SAVINGS.test(a.subtype ?? "") ? "savings" : "spending";
}

function kindOf(s: RecurringSeries, last: Classified, inflow: boolean): FlowKind {
  if (inflow) return last.class === "income" ? "income" : last.class === "transfer" ? "transfer" : "other";
  if (last.tx.pfcDetailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "card-payment";
  if (last.class === "transfer" || last.class === "investment_contribution") return "transfer";
  return s.kind === "bill" ? "bill" : "subscription";
}

/** The amount to plan for: the higher recent amount for a bill, the lower one for pay. */
function plannedCents(s: RecurringSeries, inflow: boolean): number {
  if (inflow) return Math.min(s.lastCents, s.typicalCents);
  if (s.variable) return Math.max(s.lastCents, s.typicalCents);
  return s.priceChangeCents !== 0 ? s.lastCents : s.typicalCents;
}

export function forecastCash(opts: {
  asOf: string;
  accounts: CashAccount[];
  classified: Classified[];
  pending?: SpendingTx[];
  cushionCents: number;
  horizonDays?: number;
  /** Merchant keys the user marked "not recurring". */
  hiddenMerchants?: Set<string>;
  /** Bills added by hand; each is dropped on a date where the history already has the charge. */
  scheduled?: ScheduledBill[];
}): CashForecast {
  const { asOf, cushionCents } = opts;
  const horizon = opts.horizonDays ?? 30;
  const today = dayNum(asOf);
  const end = today + horizon - 1;
  const hidden = opts.hiddenMerchants ?? new Set<string>();
  const byId = new Map(opts.classified.map((c) => [c.tx.id, c]));

  const forecasts: AccountForecast[] = [];
  for (const account of opts.accounts) {
    const role = accountRole(account);
    if (!role) continue;
    const mine = opts.classified.filter((c) => c.tx.accountId === account.id && !c.tx.pending);
    const series = detectSeries(
      mine.map((c) => ({
        c,
        key: `${c.tx.amountCents < 0 ? "in" : "out"}:${merchantKey(c.tx.name, c.tx.merchant)}`,
        cents: Math.abs(c.tx.amountCents),
      })),
      asOf,
    );
    const pendingLeft = (opts.pending ?? []).filter((t) => t.accountId === account.id);
    const scheduledIds = new Set<string>();
    const items: CashFlowItem[] = [];
    for (const s of series) {
      const inflow = s.key.startsWith("in:");
      const merchant = s.key.slice(s.key.indexOf(":") + 1).split("|")[0] as string;
      // Under a dollar (interest credits, round-ups) only clutters the list.
      if (!s.active || hidden.has(merchant) || plannedCents(s, inflow) < 100) continue;
      const last = byId.get(s.transactionIds[s.transactionIds.length - 1] as string);
      if (!last) continue;
      const kind = kindOf(s, last, inflow);
      // Pay counts once it has repeated three times; a bill counts from its second charge.
      if (inflow && s.confidence !== "confirmed") continue;
      for (const id of s.transactionIds) scheduledIds.add(id);
      const cents = plannedCents(s, inflow);
      let d = s.nextDate;
      while (dayNum(d) < today - 5) d = advance(d, s.cadence, STEP[s.cadence]);
      for (; dayNum(d) <= end; d = advance(d, s.cadence, STEP[s.cadence])) {
        const late = dayNum(d) < today;
        // Pay that is late is not assumed to arrive; a late bill is assumed due today.
        if (late && inflow) continue;
        const date = late ? asOf : d;
        // A pending charge that matches is already in the available balance.
        const hit = pendingLeft.findIndex(
          (p) =>
            p.amountCents < 0 === inflow &&
            merchantKey(p.name, p.merchant) === merchant &&
            Math.abs(Math.abs(p.amountCents) - cents) <= 0.25 * cents &&
            Math.abs(dayNum(p.date) - dayNum(d)) <= 7,
        );
        if (hit >= 0) {
          pendingLeft.splice(hit, 1);
          continue;
        }
        items.push({
          key: `${s.key}@${date}`,
          seriesKey: s.key,
          accountId: account.id,
          name: cleanName(s.name),
          date,
          deltaCents: inflow ? cents : -cents,
          kind,
          cadence: s.cadence,
          confidence: s.confidence,
          late,
        });
      }
    }

    // Bills added by hand, on each date in the window, unless the bank already accounts for it:
    // a repeating charge from the history near that date, a pending charge, or one already posted.
    const near = (cents: number, want: number) => Math.abs(cents - want) <= 0.1 * want;
    const found = items.filter((i) => i.deltaCents < 0);
    for (const bill of (opts.scheduled ?? []).filter((b) => b.accountId === account.id)) {
      for (let d = nextDue(bill, asOf); dayNum(d) <= end; d = advance(d, bill.cadence, STEP[bill.cadence])) {
        const at = dayNum(d);
        if (found.some((i) => near(-i.deltaCents, bill.amountCents) && Math.abs(dayNum(i.date) - at) <= 5))
          continue;
        const hit = pendingLeft.findIndex(
          (p) => near(p.amountCents, bill.amountCents) && Math.abs(dayNum(p.date) - at) <= 7,
        );
        if (hit >= 0) {
          pendingLeft.splice(hit, 1);
          continue;
        }
        if (
          at - today <= 5 &&
          mine.some(
            (c) =>
              near(c.tx.amountCents, bill.amountCents) &&
              dayNum(c.tx.date) >= at - 5 &&
              dayNum(c.tx.date) <= today,
          )
        )
          continue;
        items.push({
          key: `manual:${bill.id}@${d}`,
          seriesKey: `manual:${bill.id}`,
          accountId: account.id,
          name: bill.name,
          date: d,
          deltaCents: -bill.amountCents,
          kind: "bill",
          cadence: bill.cadence,
          confidence: "confirmed",
          late: false,
          scheduledId: bill.id,
        });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.deltaCents - b.deltaCents);

    // Usual day-to-day spending: the last 90 days of purchases and cash out, without scheduled items.
    const first = mine.reduce((m, c) => Math.min(m, dayNum(c.tx.date)), today);
    const span = Math.max(14, Math.min(90, today - first));
    let paceTotal = 0;
    for (const c of mine) {
      const age = today - dayNum(c.tx.date);
      if (age < 0 || age >= span || scheduledIds.has(c.tx.id)) continue;
      const spendingLike =
        c.class === "living_expense" ||
        c.class === "refund" ||
        (c.class === "transfer" && c.flags.includes("possible-spending"));
      if (spendingLike) paceTotal += c.tx.amountCents;
    }
    const paceDailyCents = role === "savings" ? 0 : Math.max(0, Math.round(paceTotal / span));

    const days = path(account.balanceCents, items, today, horizon, paceDailyCents);
    const low = lowest(days);
    const firstNeg = days.find((x) => x.lowCents < 0);
    const shortfall = firstNeg
      ? {
          date: firstNeg.date,
          cents: firstNeg.lowCents,
          worstCents: low.cents,
          worstDate: low.date,
          cause:
            items
              .filter((i) => i.date === firstNeg.date && i.deltaCents < 0)
              .sort((a, b) => a.deltaCents - b.deltaCents)[0]?.name ?? null,
        }
      : null;
    forecasts.push({
      account,
      role,
      startCents: account.balanceCents,
      items,
      days,
      low,
      paceDailyCents,
      shortfall,
    });
  }

  // The spending accounts together.
  const pool = forecasts.filter((f) => f.role === "spending");
  let spendable: Spendable | null = null;
  let upcoming: CashForecast["upcoming"] = [];
  if (pool.length) {
    const items = pool
      .flatMap((f) => f.items)
      .sort((a, b) => a.date.localeCompare(b.date) || a.deltaCents - b.deltaCents);
    const startCents = pool.reduce((s, f) => s + f.startCents, 0);
    const paceDailyCents = pool.reduce((s, f) => s + f.paceDailyCents, 0);
    const days = path(startCents, items, today, horizon, paceDailyCents);
    const low = lowest(days);
    const payday = items.find((i) => i.kind === "income" && i.deltaCents > 0 && i.date > asOf) ?? null;
    const daysToPayday = payday ? dayNum(payday.date) - today : horizon;
    const maxTodayCents = Math.max(0, low.cents - cushionCents);
    // The largest daily amount that keeps every day's low point at or above the cushion.
    const perDayCents = Math.max(
      0,
      Math.floor(Math.min(...days.map((d, i) => (d.lowCents - cushionCents) / (i + 1)))),
    );
    const safeToSpendCents = Math.min(maxTodayCents, perDayCents * Math.max(1, daysToPayday));
    let running = startCents;
    upcoming = items.map((i) => {
      running += i.deltaCents;
      return { ...i, balanceAfterCents: running };
    });
    spendable = {
      accountIds: pool.map((f) => f.account.id),
      startCents,
      days,
      low,
      safeToSpendCents,
      maxTodayCents,
      nextPayday: payday ? { date: payday.date, cents: payday.deltaCents, name: payday.name } : null,
      daysToPayday,
      perDayCents,
      billsBeforePaydayCents: items
        .filter((i) => i.deltaCents < 0 && (!payday || i.date < payday.date))
        .reduce((s, i) => s - i.deltaCents, 0),
      paceDailyCents,
      paceRunsOut: days.find((x) => x.paceCents < 0)?.date ?? null,
    };
  }

  // Cover each spending account's shortfall from the personal account with the most to spare.
  const spare = new Map(
    forecasts.filter((f) => f.role !== "business").map((f) => [f.account.id, Math.max(0, f.low.cents)]),
  );
  const transfers: TransferSuggestion[] = [];
  for (const f of forecasts.filter((x) => x.role === "spending" && x.shortfall)) {
    const short = f.shortfall as NonNullable<AccountForecast["shortfall"]>;
    const need = Math.ceil(-short.worstCents / 1000) * 1000;
    const from = [...spare]
      .filter(([id]) => id !== f.account.id)
      .sort((a, b) => b[1] - a[1])
      .find(([, cents]) => cents >= 1000);
    if (!from) continue;
    const cents = Math.min(need, Math.floor(from[1] / 1000) * 1000);
    spare.set(from[0], from[1] - cents);
    const before = dayNum(short.date) - 1;
    transfers.push({
      fromAccountId: from[0],
      toAccountId: f.account.id,
      cents,
      byDate: iso(Math.max(today, before)),
    });
  }

  const feesCents = opts.classified
    .filter(
      (c) =>
        c.tx.amountCents > 0 &&
        today - dayNum(c.tx.date) < 365 &&
        (FEE_DETAILED.has(c.tx.pfcDetailed ?? "") || FEE_NAME.test(c.tx.name)),
    )
    .reduce((s, c) => s + c.tx.amountCents, 0);

  return {
    asOf,
    horizonDays: horizon,
    cushionCents,
    accounts: forecasts,
    spendable,
    upcoming,
    transfers,
    feesCents,
  };
}

/** A bill's next due date on or after `asOf`: earlier dates are assumed paid. */
export function nextDue(bill: Pick<ScheduledBill, "cadence" | "nextDate">, asOf: string): string {
  let d = bill.nextDate;
  while (d < asOf) d = advance(d, bill.cadence, STEP[bill.cadence]);
  return d;
}

/** "Zelle payment to HAYLEY B for \"Nov\"; Conf# X" becomes "Zelle payment to HAYLEY B". */
function cleanName(name: string): string {
  return name
    .replace(/\s+for ".*$/i, "")
    .replace(/;?\s*Conf(?:irmation)?#.*$/i, "")
    .trim();
}

/** Day by day: each day's money out first (its low point), then its money in. */
function path(
  startCents: number,
  items: CashFlowItem[],
  today: number,
  horizon: number,
  paceDailyCents: number,
): ForecastDay[] {
  const days: ForecastDay[] = [];
  let bal = startCents;
  for (let i = 0; i < horizon; i++) {
    const date = iso(today + i);
    const todays = items.filter((x) => x.date === date);
    bal += todays.filter((x) => x.deltaCents < 0).reduce((s, x) => s + x.deltaCents, 0);
    const lowCents = bal;
    bal += todays.filter((x) => x.deltaCents > 0).reduce((s, x) => s + x.deltaCents, 0);
    days.push({ date, committedCents: bal, lowCents, paceCents: bal - paceDailyCents * (i + 1) });
  }
  return days;
}

function lowest(days: ForecastDay[]): { date: string; cents: number } {
  let best = days[0] as ForecastDay;
  for (const d of days) if (d.lowCents < best.lowCents) best = d;
  return { date: best.date, cents: best.lowCents };
}
