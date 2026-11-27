// Alerts: what changed that is worth a look. Pure, and keyed so a dismissal
// or a notification is remembered per event (a new price, a new month).
import type { BudgetLine } from "./budgets";
import { BUSINESS_COVER_DAYS, type CashForecast, type TransferSuggestion } from "./cashflow";
import type { Classified } from "./index";
import type { RecurringSeries } from "./recurring";

export type AlertKind =
  | "new-subscription"
  | "price-increase"
  | "large-charge"
  | "budget-over"
  | "budget-near"
  | "low-balance"
  | "bill-due"
  | "overdraft-risk"
  | "move-not-seen"
  | "spending-pace";

export interface Alert {
  key: string;
  kind: AlertKind;
  severity: "info" | "warn" | "bad";
  title: string;
  detail: string;
  date: string;
  amountCents?: number;
}

export interface AlertSettings {
  largeChargeCents: number;
  lowBalanceCents: number;
  billLeadDays: number;
}

export interface AlertAccount {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  currentCents: number;
  availableCents: number | null;
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  });

/** The plan in words: each move, the date, the fees it avoids and anything still short. */
export function planText(moves: TransferSuggestion[], nameOf: (id: string) => string, asOf: string): string {
  const first = moves[0];
  if (!first) return " No account can spare the money, so hold off on spending from it until money comes in.";
  const parts = moves.map((m) => `${usd(m.cents)} from ${nameOf(m.fromAccountId)}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const fees = moves.reduce((s, m) => s + m.feesAvoidedCents, 0);
  return (
    ` Move ${list} ${first.byDate <= asOf ? "today" : `by ${shortDate(first.byDate)}`}${fees > 0 ? ` to avoid about ${usd(fees)} in fees` : ""}.` +
    (first.uncoveredCents > 0
      ? ` That still leaves it ${usd(first.uncoveredCents)} short, so hold off on spending from it.`
      : "")
  );
}

function isoDay(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

function day(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
}

/** "Dec 3": dates in alert text. */
function shortDate(d: string): string {
  return new Date(day(d) * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** ISO week label, so a low balance is raised at most once a week per account. */
export function weekOf(d: string): string {
  const t = new Date(day(d) * 86_400_000);
  // Thursday of this week decides the ISO year.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

/** The next charge: the latest amount when it varies or the price just moved, else the typical one. */
export function expectedCents(s: RecurringSeries): number {
  return s.variable || s.priceChangeCents !== 0 ? s.lastCents : s.typicalCents;
}

export function categoryName(primary: string): string {
  return primary
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}

export function buildAlerts(opts: {
  asOf: string;
  recurring: RecurringSeries[];
  budgets: BudgetLine[];
  classified: Classified[];
  accounts: AlertAccount[];
  settings: AlertSettings;
  /** The cash forecast: raises overdraft-risk and spending-pace alerts. */
  cash?: CashForecast | null;
}): Alert[] {
  const { asOf, settings } = opts;
  const now = day(asOf);
  const out: Alert[] = [];

  for (const s of opts.recurring) {
    if (!s.active) continue;
    if (s.isNew && s.kind === "subscription") {
      out.push({
        key: `new:${s.key}`,
        kind: "new-subscription",
        severity: "info",
        title: `New subscription: ${s.name}`,
        detail: `${usd(s.typicalCents)} ${s.cadence}, about ${usd(s.monthlyCents * 12)} a year. First charged ${s.firstDate}.`,
        date: s.lastDate,
        amountCents: s.typicalCents,
      });
    }
    if (s.priceChangeCents > 0) {
      out.push({
        key: `price:${s.key}:${s.lastDate}`,
        kind: "price-increase",
        severity: "warn",
        title: `${s.name} went up ${usd(s.priceChangeCents)}`,
        detail: `Now ${usd(s.lastCents)} ${s.cadence} (was ${usd(s.lastCents - s.priceChangeCents)}).`,
        date: s.lastDate,
        amountCents: s.priceChangeCents,
      });
    }
    const until = day(s.nextDate) - now;
    if (until >= 0 && until <= settings.billLeadDays) {
      out.push({
        key: `due:${s.key}:${s.nextDate}`,
        kind: "bill-due",
        severity: "info",
        title: `${s.name} due ${until === 0 ? "today" : until === 1 ? "tomorrow" : `in ${until} days`}`,
        detail: `Expected about ${usd(expectedCents(s))} on ${s.nextDate}.`,
        date: s.nextDate,
        amountCents: expectedCents(s),
      });
    }
  }

  for (const c of opts.classified) {
    if (c.class !== "living_expense" || c.tx.pending || c.tx.amountCents < settings.largeChargeCents)
      continue;
    const age = now - day(c.tx.date);
    if (age < 0 || age > 7) continue;
    out.push({
      key: `large:${c.tx.id}`,
      kind: "large-charge",
      severity: "warn",
      title: `Large charge: ${usd(c.tx.amountCents)} at ${c.tx.merchant ?? c.tx.name}`,
      detail: `On ${c.tx.date}. If it was a one-time purchase, mark it so in the spending review so it does not inflate your plan.`,
      date: c.tx.date,
      amountCents: c.tx.amountCents,
    });
  }

  const month = asOf.slice(0, 7);
  for (const b of opts.budgets) {
    if (b.budgetCents === null) continue;
    if (b.status === "over") {
      out.push({
        key: `budget-over:${b.category}:${month}`,
        kind: "budget-over",
        severity: "bad",
        title: `Over budget: ${categoryName(b.category)}`,
        detail: `${usd(b.spentCents)} spent of ${usd(b.budgetCents)} this month.`,
        date: asOf,
        amountCents: b.spentCents - b.budgetCents,
      });
    } else if (b.status === "near") {
      out.push({
        key: `budget-near:${b.category}:${month}`,
        kind: "budget-near",
        severity: "warn",
        title: `On pace to pass budget: ${categoryName(b.category)}`,
        detail: `${usd(b.spentCents)} spent; a typical rest of the month brings it to about ${usd(b.projectedCents)} of ${usd(b.budgetCents)}.`,
        date: asOf,
        amountCents: b.projectedCents - b.budgetCents,
      });
    }
  }

  for (const a of opts.accounts) {
    if (a.type !== "depository" || (a.subtype !== "checking" && a.subtype !== "savings")) continue;
    const bal = a.availableCents ?? a.currentCents;
    if (bal >= settings.lowBalanceCents) continue;
    out.push({
      key: `low:${a.id}:${weekOf(asOf)}`,
      kind: "low-balance",
      severity: "bad",
      title: `Low balance: ${a.name}`,
      detail: `${usd(bal)} available, under your ${usd(settings.lowBalanceCents)} alert level.`,
      date: asOf,
      amountCents: bal,
    });
  }

  const cash = opts.cash;
  if (cash) {
    const names = new Map(cash.accounts.map((f) => [f.account.id, f.account.name]));
    const nameOf = (id: string) => names.get(id) ?? "another account";
    for (const f of cash.accounts) {
      if (f.role === "savings" || !f.shortfall) continue;
      const s = f.shortfall;
      const business = f.role === "business";
      // A business forecast leaves out income that does not arrive on a schedule, so only a
      // shortfall within the week its plan covers is worth a warning.
      if (business && day(s.date) - day(asOf) >= BUSINESS_COVER_DAYS) continue;
      out.push({
        // Keyed by week, so a forecast that shifts a day does not alert again.
        key: `overdraft:${f.account.id}:${weekOf(s.date)}`,
        kind: "overdraft-risk",
        severity: "bad",
        title: `Overdraft risk: ${f.account.name} on ${shortDate(s.date)}`,
        detail:
          (business
            ? `Its bills take it to ${usd(s.cents)}`
            : `Bills due before money comes in take it to ${usd(s.cents)}`) +
          `${s.cause ? ` (${s.cause} on ${shortDate(s.date)})` : ""}` +
          (!business && s.worstCents < s.cents
            ? `, and to ${usd(s.worstCents)} by ${shortDate(s.worstDate)}`
            : "") +
          "." +
          planText(
            cash.transfers.filter((t) => t.toAccountId === f.account.id),
            nameOf,
            asOf,
          ),
        date: s.date,
        amountCents: s.worstCents,
      });
    }

    // A move the user marked as made that has not shown up two days after its date: if it did
    // not happen, the forecast is hiding a shortfall.
    for (const m of cash.moves) {
      if (!m.counted || m.seenTxId || day(asOf) - day(m.date) < 2) continue;
      out.push({
        key: `move-not-seen:${m.id}`,
        kind: "move-not-seen",
        severity: "warn",
        title: `${usd(m.cents)} move to ${nameOf(m.toAccountId)} not seen yet`,
        detail:
          `You marked it moved from ${nameOf(m.fromAccountId)} for ${shortDate(m.date)}, but no deposit of about that amount has shown up. ` +
          `The forecast counts it until ${shortDate(isoDay(day(m.date) + 7))}; if it did not happen, remove it on Safe to spend.`,
        date: m.date,
        amountCents: m.cents,
      });
    }
    const sp = cash.spendable;
    const committedShort = cash.accounts.some((f) => f.role === "spending" && f.shortfall);
    if (sp?.paceRunsOut && !committedShort && day(sp.paceRunsOut) - day(asOf) <= 14) {
      out.push({
        key: `pace:${weekOf(asOf)}`,
        kind: "spending-pace",
        severity: "warn",
        title: `At your usual spending you run short around ${shortDate(sp.paceRunsOut)}`,
        detail: `Safe to spend${sp.nextPayday ? ` until ${shortDate(sp.nextPayday.date)}` : ""}: ${usd(sp.safeToSpendCents)}, about ${usd(sp.perDayCents)} a day.`,
        date: asOf,
        amountCents: sp.safeToSpendCents,
      });
    }
  }

  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.date.localeCompare(x.date));
}
