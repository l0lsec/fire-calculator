// What each Bills-page total is made of: the series that add up to it, each with
// the arithmetic that turns its typical charge into a monthly figure.
import type { AccountForecast, CashFlowItem, CashForecast, RecurringSeries } from "@fire/spending";
import { type Breakdown, type BreakdownLine, type BreakdownStep, foldSlices } from "@/lib/breakdown";
import type { Charge } from "@/lib/charges";
import { usdCents } from "@/lib/format";

/** Days in each cycle, the same figures the detector uses (packages/spending/src/recurring.ts). */
export const CYCLE_DAYS: Record<RecurringSeries["cadence"], number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  yearly: 365.25,
};

const EVERY: Record<RecurringSeries["cadence"], string> = {
  weekly: "every week",
  biweekly: "every 2 weeks",
  monthly: "every month",
  quarterly: "every 3 months",
  yearly: "every year",
};

/** At a 4% withdrawal rate, each dollar of yearly spending needs $25 invested. */
export const FI_MULTIPLE = 25;

/** The charge the monthly figure is based on: the latest price after a change, else the middle charge. */
export function basisCents(s: RecurringSeries): number {
  return s.priceChangeCents ? s.lastCents : s.typicalCents;
}

/** "$15.49 every month" or "$60.00 every 3 months = $20.00 a month", in words. */
export function monthlyMath(s: RecurringSeries): string {
  const basis = basisCents(s);
  const why = s.priceChangeCents
    ? "the latest charge, since the price changed"
    : s.occurrences > 2
      ? `the middle of ${s.occurrences} charges`
      : "the charge seen twice";
  const per =
    s.cadence === "monthly"
      ? ""
      : `; ${usdCents(basis, { cents: true })} × 30.44 days ÷ ${CYCLE_DAYS[s.cadence]} days = ${usdCents(s.monthlyCents, { cents: true })} a month`;
  return `${usdCents(basis, { cents: true })} ${EVERY[s.cadence]} (${why})${per}`;
}

/** The charges a series was found from (empty when none are known). */
export type ChargesOf = (s: RecurringSeries) => Charge[];

const line = (s: RecurringSeries, chargesOf: ChargesOf): BreakdownLine => ({
  op: "+",
  label: s.name,
  value: s.monthlyCents / 100,
  detail: monthlyMath(s),
  charges: chargesOf(s),
});

function listBreakdown(opts: {
  id: string;
  title: string;
  noun: string;
  active: RecurringSeries[];
  chargesOf: ChargesOf;
  stopped: RecurringSeries[];
  hidden: RecurringSeries[];
  totalCents: number;
  anchor: string;
}): Breakdown {
  const monthly = opts.totalCents / 100;
  return {
    id: opts.id,
    title: opts.title,
    intro: `Every ${opts.noun} still charging, at what it costs per month. Weekly, quarterly and yearly charges are converted to a month so they can be added up.`,
    chart: opts.active.length
      ? {
          title: `${opts.title} per month`,
          slices: foldSlices(opts.active.map((s) => ({ label: s.name, value: s.monthlyCents / 100 }))),
        }
      : undefined,
    steps: [
      {
        title: "Per month",
        lines: opts.active.length
          ? opts.active.map((s) => line(s, opts.chargesOf))
          : [{ op: "+", label: `No ${opts.noun}s found`, value: 0 }],
        total: { label: `${opts.title} per month`, value: monthly, testId: `${opts.id}-monthly-total` },
      },
      {
        title: "Per year",
        lines: [
          { op: "+", label: `${opts.title} per month`, value: monthly },
          { op: "×", label: "Months in a year", value: 12, format: "number" },
        ],
        total: { label: `${opts.title} per year`, value: monthly * 12 },
      },
    ],
    notCounted: [
      ...opts.stopped.map((s) => ({
        label: s.name,
        value: s.monthlyCents / 100,
        reason: "stopped: no charge for over 1.5 cycles",
      })),
      ...opts.hidden.map((s) => ({
        label: s.name,
        value: s.monthlyCents / 100,
        reason: "you marked it not recurring",
      })),
    ],
    links: [{ href: opts.anchor, label: `Each ${opts.noun} and its charges, below` }],
  };
}

export interface RecurringTotals {
  subscriptions: RecurringSeries[];
  bills: RecurringSeries[];
  inactive: RecurringSeries[];
  hidden: RecurringSeries[];
  subscriptionMonthlyCents: number;
  billMonthlyCents: number;
}

export function billsBreakdowns(
  r: RecurringTotals,
  chargesOf: ChargesOf = () => [],
): Record<"subscriptions" | "bills" | "fi-effect", Breakdown> {
  const subsMonthly = r.subscriptionMonthlyCents / 100;
  const of = (kind: RecurringSeries["kind"], xs: RecurringSeries[]) => xs.filter((s) => s.kind === kind);
  return {
    subscriptions: listBreakdown({
      id: "subscriptions",
      title: "Subscriptions",
      noun: "subscription",
      active: r.subscriptions,
      chargesOf,
      stopped: of("subscription", r.inactive),
      hidden: of("subscription", r.hidden),
      totalCents: r.subscriptionMonthlyCents,
      anchor: "#subscription-list",
    }),
    bills: listBreakdown({
      id: "bills",
      title: "Bills",
      noun: "bill",
      active: r.bills,
      chargesOf,
      stopped: of("bill", r.inactive),
      hidden: of("bill", r.hidden),
      totalCents: r.billMonthlyCents,
      anchor: "#bill-list",
    }),
    "fi-effect": {
      id: "fi-effect",
      title: "Effect on your FI number",
      intro:
        "How much you would need invested to pay for your subscriptions forever, withdrawing 4% a year. Bills are left out here because most are needs you would keep.",
      steps: [
        {
          lines: [
            {
              op: "+",
              label: "Subscriptions per month",
              value: subsMonthly,
              detail: "the Subscriptions total",
            },
            { op: "×", label: "Months in a year", value: 12, format: "number" },
            {
              op: "×",
              label: "Invested per dollar of yearly spending",
              value: FI_MULTIPLE,
              format: "number",
              detail: "1 ÷ 4% withdrawal rate",
            },
          ],
          total: { label: "Invested to cover them", value: subsMonthly * 12 * FI_MULTIPLE },
        },
      ],
      facts: [
        {
          label: "Each $10 a month you cut",
          value: `lowers the target by ${usdCents(10 * 12 * FI_MULTIPLE * 100)}`,
        },
      ],
      links: [{ href: "#subscription-list", label: "Your subscriptions, below" }],
    },
  };
}

export interface BudgetLineIn {
  category: string;
  budgetCents: number | null;
  spentCents: number;
}

/** "$1,240 of $2,000 budgeted this month": the budgeted categories it adds up. */
export function budgetBreakdown(
  lines: BudgetLineIn[],
  name: (category: string) => string,
  chargesOf: (category: string) => Charge[],
  month: string,
): Breakdown {
  const budgeted = lines.filter((b) => b.budgetCents !== null);
  const spent = budgeted.reduce((s, b) => s + b.spentCents, 0) / 100;
  const budget = budgeted.reduce((s, b) => s + (b.budgetCents ?? 0), 0) / 100;
  return {
    id: "budget-total",
    title: "Spent this month",
    intro: `What you spent in ${month} in the categories you have a budget for. Refunds count against the spending; transfers, card payments and loan payments are left out.`,
    chart: {
      title: "Spent this month by category",
      slices: foldSlices(budgeted.map((b) => ({ label: name(b.category), value: b.spentCents / 100 }))),
    },
    steps: [
      {
        title: "Spent",
        lines: budgeted.map((b) => ({
          op: "+" as const,
          label: name(b.category),
          value: b.spentCents / 100,
          charges: chargesOf(b.category),
        })),
        total: { label: "Spent in budgeted categories", value: spent, testId: "budget-total-spent" },
      },
      {
        title: "Budgeted",
        lines: budgeted.map((b) => ({
          op: "+" as const,
          label: name(b.category),
          value: (b.budgetCents ?? 0) / 100,
        })),
        total: { label: "Budgeted this month", value: budget },
      },
    ],
    notCounted: lines
      .filter((b) => b.budgetCents === null && b.spentCents > 0)
      .map((b) => ({ label: name(b.category), value: b.spentCents / 100, reason: "no budget set" })),
    links: [{ href: "#by-category", label: "Each category, below" }],
  };
}

/** "Dec 3" */
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * From the balance now to the lowest point: every scheduled item before the low
 * day, and that day's money out (the low is after a day's money out and before
 * its money in). Each predicted item opens the past charges it came from.
 */
function lowPointStep(
  start: { name: string; cents: number }[],
  items: CashFlowItem[],
  low: { date: string; cents: number },
  chargesFor: (ids: string[]) => Charge[],
  testId: string,
): BreakdownStep {
  const d = (cents: number) => cents / 100;
  const before = items.filter((i) => i.date < low.date || (i.date === low.date && i.deltaCents < 0));
  return {
    title: `Your lowest point, ${shortDate(low.date)}`,
    lines: [
      ...start.map((a) => ({
        op: "+" as const,
        label: a.name,
        value: d(a.cents),
        detail: "available balance now",
      })),
      ...before.map((i) => {
        const charges = chargesFor(i.sourceIds);
        return {
          op: i.deltaCents < 0 ? ("-" as const) : ("+" as const),
          label: `${i.name}, ${shortDate(i.date)}`,
          value: Math.abs(d(i.deltaCents)),
          detail: i.scheduledId
            ? "a bill you added"
            : i.late
              ? "was due earlier, so counted today"
              : charges.length
                ? `predicted from ${charges.length} past ${i.deltaCents < 0 ? "charges" : "deposits"}`
                : undefined,
          ...(charges.length ? { charges, chargesIn: i.deltaCents > 0 } : {}),
        };
      }),
    ],
    total: { label: `Lowest point, ${shortDate(low.date)}`, value: d(low.cents), testId },
  };
}

/** One account's lowest point in the forecast: its balance now and its own bills and deposits. */
export function accountLowBreakdown(
  f: AccountForecast,
  accountName: string,
  chargesFor: (ids: string[]) => Charge[],
): Breakdown {
  return {
    id: `low-${f.account.id}`,
    title: `${accountName}, lowest point`,
    intro: `This account's balance now, then each bill and deposit predicted for it in date order, up to its lowest day. Day-to-day spending is not in it${f.role === "business" ? ", and business income that does not arrive on a schedule is not counted, so this is the worst case" : ""}.`,
    steps: [
      lowPointStep(
        [{ name: accountName, cents: f.startCents }],
        f.items,
        f.low,
        chargesFor,
        "account-low-total",
      ),
    ],
    links: [{ href: "#coming-up", label: "Every bill and paycheck, below" }],
  };
}

/**
 * Safe to spend, step by step: the spending accounts' balance now, every item
 * up to the lowest day, the cushion, and the daily allowance to payday. Each
 * predicted bill or paycheck opens the past charges it was predicted from.
 */
export function safeBreakdown(
  cash: CashForecast,
  accountName: (id: string) => string,
  chargesFor: (ids: string[]) => Charge[],
): Breakdown | null {
  const sp = cash.spendable;
  if (!sp) return null;
  const d = (cents: number) => cents / 100;
  const pool = cash.accounts.filter((f) => f.role === "spending");
  const days = Math.max(1, sp.daysToPayday);
  const paced = sp.perDayCents * days;
  return {
    id: "safe",
    title: "Safe to spend",
    intro:
      "Your spending accounts' balance now, then every bill and paycheck in date order up to the lowest day, less the cushion you keep. The amount is then spread over the days to payday so the bills after it are covered too.",
    steps: [
      lowPointStep(
        pool.map((f) => ({ name: accountName(f.account.id), cents: f.startCents })),
        cash.upcoming,
        sp.low,
        chargesFor,
        "safe-low-total",
      ),
      {
        title: "Most that could go out today",
        lines: [
          { op: "+", label: "Lowest point", value: d(sp.low.cents) },
          {
            op: "-",
            label: "Your cushion",
            value: d(cash.cushionCents),
            detail: "kept back; change it below",
          },
        ],
        total: { label: "Most that could go out today", value: d(sp.low.cents - cash.cushionCents) },
      },
      {
        title: "Spread to payday",
        lines: [
          {
            op: "+",
            label: "Daily allowance",
            value: d(sp.perDayCents),
            detail: `the most you can spend every day and stay above your cushion on each of the next ${cash.horizonDays} days`,
          },
          {
            op: "×",
            label: sp.nextPayday
              ? `Days to payday, ${shortDate(sp.nextPayday.date)}`
              : "Days in the forecast",
            value: days,
            format: "number",
          },
        ],
        total: { label: "At that pace until payday", value: d(paced) },
      },
    ],
    facts: [
      {
        label: "Safe to spend",
        value: `${usdCents(sp.safeToSpendCents)}, the smaller of the last two totals (never below $0)`,
      },
    ],
    links: [{ href: "#coming-up", label: "Every bill and paycheck, below" }],
  };
}
