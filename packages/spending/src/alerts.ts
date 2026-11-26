// Alerts: what changed that is worth a look. Pure, and keyed so a dismissal
// or a notification is remembered per event (a new price, a new month).
import type { BudgetLine } from "./budgets";
import type { Classified } from "./index";
import type { RecurringSeries } from "./recurring";

export type AlertKind =
  | "new-subscription"
  | "price-increase"
  | "large-charge"
  | "budget-over"
  | "budget-near"
  | "low-balance"
  | "bill-due";

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

function day(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
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

  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.date.localeCompare(x.date));
}
