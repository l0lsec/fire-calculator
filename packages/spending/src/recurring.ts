// Recurring charges (subscriptions and bills) from classified transactions.
// Pure: classified transactions in, recurring series out.
//
// A series is a merchant charging on a steady cadence. Merchants that bill
// several plans (one Apple charge for iCloud, another for Music) are split
// by amount when the merchant as a whole is not regular.
import type { Classified } from "./index";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const CADENCES: { cadence: Cadence; min: number; max: number; days: number }[] = [
  { cadence: "weekly", min: 5, max: 9, days: 7 },
  { cadence: "biweekly", min: 12, max: 17, days: 14 },
  { cadence: "monthly", min: 26, max: 35, days: 30.44 },
  { cadence: "quarterly", min: 80, max: 100, days: 91.31 },
  { cadence: "yearly", min: 330, max: 400, days: 365.25 },
];

// Interest and fees recur too, but they are costs of debt, not subscriptions.
const BILL_PRIMARY = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "MEDICAL", "BANK_FEES"]);
const BILL_DETAILED = new Set([
  "GENERAL_SERVICES_INSURANCE",
  "GENERAL_SERVICES_CHILDCARE",
  "GENERAL_SERVICES_EDUCATION",
]);

export interface RecurringSeries {
  /** Stable id for hiding and alert keys: merchant, cadence and (when split) plan. */
  key: string;
  name: string;
  category: string;
  primary: string;
  kind: "subscription" | "bill";
  cadence: Cadence;
  /** Median charge. */
  typicalCents: number;
  lastCents: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  /** The typical charge expressed per month. */
  monthlyCents: number;
  /** Amounts swing more than 20% (a utility bill, say). */
  variable: boolean;
  /** Still charging: the last charge is no more than 1.5 cycles old. */
  active: boolean;
  /** First seen within about three cycles. */
  isNew: boolean;
  /** Two matching charges only; three or more is "confirmed". */
  confidence: "likely" | "confirmed";
  /** Last charge minus the typical earlier charge, when a fixed price moved. */
  priceChangeCents: number;
  transactionIds: string[];
}

function day(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
}
function iso(n: number): string {
  return new Date(Math.round(n) * 86_400_000).toISOString().slice(0, 10);
}
function addMonths(d: string, n: number): string {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7) - 1 + n;
  const dd = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(dd, last))).toISOString().slice(0, 10);
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** A readable name for bank-transfer descriptions with no merchant ("AMEX DES:... INDN:..."). */
export function displayName(name: string, merchant: string | null): string {
  if (merchant) return merchant;
  const head = name.split(/\s+(?:DES|ID|INDN|CO ID|PPD|WEB):/)[0]?.trim() || name;
  return head.length > 48 ? `${head.slice(0, 45)}...` : head;
}

/** "NETFLIX.COM 866-579-7172 CA" and "Netflix" both become "netflix". */
export function merchantKey(name: string, merchant: string | null): string {
  const base = (merchant ?? name)
    .toLowerCase()
    .replace(/\.(com|net|org|io|co)\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\b(pos|ach|debit|purchase|recurring|payment|online|www|inc|llc)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    // A trailing two-letter state code ("NETFLIX.COM CA").
    .replace(/^(.+) [a-z]{2}$/, "$1");
  return base.split(" ").slice(0, 3).join(" ") || "unknown";
}

interface Charge {
  c: Classified;
  d: number;
  cents: number;
}

function cadenceOf(charges: Charge[]): (typeof CADENCES)[number] | null {
  if (charges.length < 2) return null;
  const gaps = charges.slice(1).map((x, i) => x.d - (charges[i] as Charge).d);
  if (gaps.some((g) => g < 2)) return null; // several charges a day is shopping, not a subscription
  const med = median(gaps);
  const band = CADENCES.find((b) => med >= b.min && med <= b.max);
  if (!band) return null;
  const inBand = gaps.filter((g) => g >= band.min && g <= band.max).length;
  return inBand / gaps.length >= 0.7 ? band : null;
}

function cv(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd / mean;
}

function series(
  key: string,
  charges: Charge[],
  band: (typeof CADENCES)[number],
  asOf: number,
): RecurringSeries | null {
  const amounts = charges.map((x) => x.cents);
  const variable = cv(amounts) > 0.2;
  // Two charges only count when they match closely (a just-started subscription).
  if (
    charges.length === 2 &&
    Math.abs((amounts[0] as number) - (amounts[1] as number)) > Math.max(50, 0.02 * (amounts[0] as number))
  )
    return null;
  if (charges.length < 2) return null;
  // Two small matching charges are usually coincidence (a coffee a year apart).
  if (charges.length === 2 && (amounts[0] as number) < (band.cadence === "yearly" ? 2000 : 500)) return null;
  const first = charges[0] as Charge;
  const last = charges[charges.length - 1] as Charge;
  const gaps = charges.slice(1).map((x, i) => x.d - (charges[i] as Charge).d);
  const step = Math.round(median(gaps));
  // Calendar cadences repeat on the same day of the month, not every N days.
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[band.cadence as "monthly"] ?? 0;
  const next = months ? addMonths(iso(last.d), months) : iso(last.d + step);
  const typical = Math.round(median(amounts));
  const earlier = amounts.slice(0, -1);
  const prev = Math.round(median(earlier));
  let priceChange = 0;
  if (!variable && charges.length >= 3 && Math.abs(last.cents - prev) >= Math.max(100, 0.05 * prev)) {
    priceChange = last.cents - prev;
  }
  const c = last.c;
  const primary = c.tx.pfcPrimary ?? "UNCATEGORIZED";
  const bill =
    c.class === "debt_payment" ||
    c.essential ||
    BILL_PRIMARY.has(primary) ||
    BILL_DETAILED.has(c.tx.pfcDetailed ?? "");
  return {
    key,
    name: displayName(c.tx.name, c.tx.merchant),
    category: c.category,
    primary,
    kind: bill ? "bill" : "subscription",
    cadence: band.cadence,
    typicalCents: typical,
    lastCents: last.cents,
    firstDate: iso(first.d),
    lastDate: iso(last.d),
    nextDate: next,
    occurrences: charges.length,
    monthlyCents: Math.round((typical * 30.44) / band.days),
    variable,
    active: asOf <= last.d + band.days * 1.5 + 3,
    isNew: first.d >= asOf - (band.days * 3 + 5),
    confidence: charges.length >= 3 ? "confirmed" : "likely",
    priceChangeCents: priceChange,
    transactionIds: charges.map((x) => x.c.tx.id),
  };
}

/** Split one merchant's charges into plans of similar amount (within 20% of the plan's median). */
function plans(charges: Charge[]): Charge[][] {
  const byAmount = [...charges].sort((a, b) => a.cents - b.cents);
  const out: Charge[][] = [];
  for (const ch of byAmount) {
    const cur = out[out.length - 1];
    if (cur && ch.cents <= median(cur.map((x) => x.cents)) * 1.2) cur.push(ch);
    else out.push([ch]);
  }
  return out.map((p) => p.sort((a, b) => a.d - b.d));
}

/**
 * Recurring outflows (living expenses and loan payments) as of `asOf`.
 * Pass classifications whose window reaches `asOf` (see deriveSpending).
 */
export function detectRecurring(classified: Classified[], asOf: string): RecurringSeries[] {
  const now = day(asOf);
  const groups = new Map<string, Charge[]>();
  for (const c of classified) {
    if (c.tx.pending || c.tx.amountCents <= 0) continue;
    if (c.class !== "living_expense" && c.class !== "debt_payment") continue;
    const k = merchantKey(c.tx.name, c.tx.merchant);
    const list = groups.get(k) ?? [];
    list.push({ c, d: day(c.tx.date), cents: c.tx.amountCents });
    groups.set(k, list);
  }
  const out: RecurringSeries[] = [];
  for (const [k, list] of groups) {
    const charges = list.sort((a, b) => a.d - b.d);
    const planSeries = plans(charges).flatMap((p) => {
      const band = cadenceOf(p);
      if (!band) return [];
      const planTag = Math.round(median(p.map((x) => x.cents)) / 100);
      const s = series(`${k}|${band.cadence}|${planTag}`, p, band, now);
      return s ? [s] : [];
    });
    // Two or more regular plans (Apple's iCloud and Music) beat one blended series.
    const whole = planSeries.length >= 2 ? null : cadenceOf(charges);
    const wholeSeries =
      whole && charges.length >= 3 ? series(`${k}|${whole.cadence}`, charges, whole, now) : null;
    if (wholeSeries) out.push(wholeSeries);
    else out.push(...planSeries);
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents);
}
