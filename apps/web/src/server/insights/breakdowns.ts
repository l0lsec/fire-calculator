// What each Bills-page total is made of: the series that add up to it, each with
// the arithmetic that turns its typical charge into a monthly figure.
import type {
  AccountForecast,
  CashFlowItem,
  CashForecast,
  RecurringSeries,
  TransferSuggestion,
} from "@fire/spending";
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

const FEE_FROM: Record<TransferSuggestion["fee"]["source"], string> = {
  yours: "the fee you set below",
  history: "what your bank charged you before",
  typical: "a typical bank fee; set your bank's fee below",
};

/** How the fee per overdraft is set: the fee you entered, or the middle of the past fees (which open). */
function feeLine(fee: TransferSuggestion["fee"], chargesFor: (ids: string[]) => Charge[]): BreakdownLine {
  const past = fee.source === "history" ? chargesFor(fee.feeIds) : [];
  return {
    op: "×",
    label: "Fee for each one",
    value: fee.perItemCents / 100,
    format: "usd",
    detail:
      fee.source === "history"
        ? `the middle of ${past.length} overdraft ${past.length === 1 ? "fee" : "fees"} charged ${fee.ownAccount ? "on this account" : "on your other accounts"} in the last 2 years`
        : FEE_FROM[fee.source],
    ...(past.length ? { charges: past } : {}),
  };
}

/**
 * The plan for one account that would go below zero: how low it goes and why,
 * how much to move and from where, why each source can spare it, and the fees
 * the moves avoid, down to the predicted charges and the past fees.
 */
export function movePlanBreakdown(
  f: AccountForecast,
  moves: TransferSuggestion[],
  accountName: (id: string) => string,
  chargesFor: (ids: string[]) => Charge[],
): Breakdown | null {
  const first = moves[0];
  if (!first || !f.shortfall) return null;
  const d = (cents: number) => cents / 100;
  const name = accountName(f.account.id);
  const business = first.coverDays !== null;
  const today = f.days[0]?.date ?? first.byDate;
  const daysToWorst = Math.round((Date.parse(first.worstDate) - Date.parse(today)) / 86_400_000) + 1;
  const needed = first.coverCents + first.paceCents;
  const overdrawn = moves.flatMap((m) => m.overdrawn);
  const fees = moves.reduce((s, m) => s + m.feesAvoidedCents, 0);
  const steps: BreakdownStep[] = [
    lowPointStep(
      [{ name, cents: f.startCents }],
      f.items,
      // A business plan covers only its week, so walk to that week's deepest point.
      business ? { date: first.worstDate, cents: -first.coverCents } : f.low,
      chargesFor,
      "move-low-total",
    ),
    {
      title: "How much to move",
      lines: business
        ? [
            {
              op: "+",
              label: `Back up to $0 at its deepest point in the week from ${shortDate(f.shortfall.date)}`,
              value: d(first.coverCents),
              detail: shortDate(first.worstDate),
            },
            { op: "+", label: "Rounded up to the next $50", value: d(first.paceCents) },
          ]
        : [
            { op: "+", label: "Back up to $0", value: d(first.coverCents) },
            {
              op: "+",
              label: `Usual day-to-day spending from it until ${shortDate(first.worstDate)}`,
              value: d(first.paceCents),
              detail: `${usdCents(f.paceDailyCents, { cents: true })} a day for ${daysToWorst} days (the last 90 days, bills left out), rounded up to the next $50`,
            },
          ],
      total: { label: "To move", value: d(needed), testId: "move-need-total" },
    },
  ];
  if (moves.length > 1 || first.uncoveredCents > 0)
    steps.push({
      title: "Where it comes from",
      lines: moves.map((m) => ({
        op: "+" as const,
        label: `From ${accountName(m.fromAccountId)}`,
        value: d(m.cents),
      })),
      total: { label: "Moved", value: d(needed - first.uncoveredCents) },
    });
  for (const m of moves)
    steps.push({
      title: `Why ${accountName(m.fromAccountId)} can spare it`,
      lines: [
        {
          op: "+",
          label: `Its lowest point from ${shortDate(m.byDate)} on`,
          value: d(m.sourceLowCents),
          detail: `${shortDate(m.sourceLowDate)}, after its own bills${m.sourceFloorCents ? " and usual spending" : ""}`,
        },
        { op: "-", label: "This move", value: d(m.cents) },
      ],
      total: {
        label: `Its lowest point after the move (it keeps ${m.sourceFloorCents ? `your ${usdCents(m.sourceFloorCents)} cushion` : "above $0"})`,
        value: d(m.sourceLowCents - m.cents),
      },
    });
  if (overdrawn.length) {
    steps.push(
      {
        title: "Charges that would come out below $0",
        lines: overdrawn.map((i) => {
          const charges = chargesFor(i.sourceIds);
          return {
            op: "+" as const,
            label: `${i.name}, ${shortDate(i.date)}`,
            value: 1,
            format: "number" as const,
            detail: `leaves it at ${usdCents(i.balanceAfterCents)}`,
            ...(charges.length ? { charges } : {}),
          };
        }),
        total: { label: "Charges below $0", value: overdrawn.length, format: "number" },
      },
      {
        title: "Fees avoided",
        lines: [
          { op: "+", label: "Charges below $0", value: overdrawn.length, format: "number" },
          feeLine(first.fee, chargesFor),
        ],
        total: { label: "Fees avoided", value: d(fees), testId: "move-fees-total" },
      },
    );
  }
  return {
    id: `move-${f.account.id}`,
    title: `Keeping ${name} above $0`,
    intro: business
      ? `${name} goes below zero on ${shortDate(f.shortfall.date)} with only the bills that repeat in its history. Business income that does not arrive on a schedule is not counted, so this covers only its bills in the week from then; check again after a deposit.`
      : `${name} goes below zero on ${shortDate(f.shortfall.date)} with only the bills and pay that repeat in its history. Moving money in by ${shortDate(first.byDate)} keeps it above zero, from accounts that can spare it for the whole next ${f.days.length} days.`,
    steps,
    ...(first.uncoveredCents > 0
      ? {
          notCounted: [
            {
              label: "Still short",
              value: d(first.uncoveredCents),
              reason: "no account can spare more without going below its own cushion or $0",
            },
          ],
        }
      : {}),
    facts: [
      { label: "Fees counted", value: "at most 3 a day, a common bank limit" },
      business
        ? {
            label: "Where the money comes from",
            value:
              "another business account first, then personal checking, then savings (money you put into the business)",
          }
        : {
            label: "Money from a business account",
            value: "used only when personal accounts cannot cover it",
          },
    ],
    links: [
      { href: "#coming-up", label: "Every bill and paycheck, below" },
      { href: "#cushion", label: "Your cushion and overdraft fee" },
    ],
  };
}

interface MoveRecord {
  id: string;
  toAccountId: string;
  amountCents: number;
  moveDate: string;
  feesAvoidedCents: number;
  feePerItemCents: number;
  basis: { items: { name: string; date: string }[] };
  feeIds: string[];
  chargedCents: number;
  savedCents: number;
}

/** The fees the user's moves avoided: each move's fees, less any overdraft fee that posted anyway. */
export function feesSavedBreakdown(
  moves: MoveRecord[],
  accountName: (id: string) => string,
  chargesFor: (ids: string[]) => Charge[],
): Breakdown | null {
  if (!moves.length) return null;
  const d = (cents: number) => cents / 100;
  const total = moves.reduce((s, m) => s + m.savedCents, 0);
  const lines: BreakdownLine[] = [];
  for (const m of moves) {
    const n = m.basis.items.length;
    lines.push({
      op: "+",
      label: `${usdCents(m.amountCents)} into ${accountName(m.toAccountId)}, ${shortDate(m.moveDate)}`,
      value: d(m.feesAvoidedCents),
      detail: n
        ? `${n} ${n === 1 ? "charge" : "charges"} would have come out below $0 (${m.basis.items.map((i) => i.name).join(", ")}), at ${usdCents(m.feePerItemCents, { cents: true })} each`
        : "no charge would have come out below $0 after the moves before it",
    });
    if (m.chargedCents > 0)
      lines.push({
        op: "-",
        label: `Overdraft fees that posted anyway on ${accountName(m.toAccountId)}`,
        value: d(Math.min(m.chargedCents, m.feesAvoidedCents)),
        charges: chargesFor(m.feeIds),
      });
  }
  return {
    id: "fees-saved",
    title: "Fees avoided by moving money",
    intro:
      "Each move you made to keep an account above $0, with the fees it avoided as worked out that day: the charges that would have come out below $0 times your bank's fee. An overdraft fee that still posted on that account is taken off.",
    steps: [{ lines, total: { label: "Fees avoided", value: d(total), testId: "fees-saved-total" } }],
    links: [{ href: "#moves", label: "Your moves" }],
  };
}

/** Overdraft, returned-payment and late fees in the last 12 months, down to the charges. */
export function feesPaidBreakdown(
  cash: CashForecast,
  chargesFor: (ids: string[]) => Charge[],
): Breakdown | null {
  if (!cash.feesCents) return null;
  const charges = chargesFor(cash.feeIds);
  return {
    id: "fees-paid",
    title: "Bank fees in the last 12 months",
    intro: "Overdraft, returned-payment and late fees charged to your accounts in the last 12 months.",
    steps: [
      {
        lines: [
          {
            op: "+",
            label: `${charges.length} ${charges.length === 1 ? "fee" : "fees"}`,
            value: cash.feesCents / 100,
            charges,
          },
        ],
        total: { label: "Fees paid", value: cash.feesCents / 100, testId: "fees-paid-total" },
      },
    ],
    links: [{ href: "/spending", label: "Spending" }],
  };
}
