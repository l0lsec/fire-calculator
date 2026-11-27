// What each bar or point of a chart over time is made of (docs/UX_PRINCIPLES.md,
// law 19). Every chart row gets a breakdown whose lines carry the transactions or
// balances behind it, so tapping a month opens the real charges. The line values
// come from the same transactions the chart adds up (test/chart-drill.test.ts).
import type { AnnualSpending, Classified } from "@fire/spending";
import type { Breakdown, BreakdownLine } from "@/lib/breakdown";
import { type Charge, chargesTotal } from "@/lib/charges";
import { type AccountLike, type CategoryTrend, type SnapshotLike, shortMonth } from "@/lib/chart-data";
import { dateText } from "@/lib/format";
import { type ChargeFinder, isLiving } from "../charges";

const monthOf = (date: string) => date.slice(0, 7);
const dollars = (cents: number) => cents / 100;

/** "March 2026" */
function longMonth(ym: string): string {
  return new Date(`${ym}-01T12:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const chargeLine = (op: "+" | "-", label: string, charges: Charge[], detail?: string): BreakdownLine => ({
  op,
  label,
  value: dollars(chargesTotal(charges)),
  ...(detail ? { detail } : {}),
  ...(charges.length ? { charges } : {}),
});

const COUNTED =
  "One-time charges count as $0 and spread-out charges at their yearly share, as you chose on the Spending page.";

/** Spending month by month: essentials and discretionary, each opening its charges. */
export function spendingMonthBreakdowns(s: AnnualSpending, find: ChargeFinder): (Breakdown | null)[] {
  return s.monthly.map(({ month }) => {
    const inMonth = (c: Classified) => isLiving(c) && monthOf(c.tx.date) === month;
    const essential = find.where((c) => inMonth(c) && c.essential, { counted: true });
    const discretionary = find.where((c) => inMonth(c) && !c.essential, { counted: true });
    if (essential.length + discretionary.length === 0) return null;
    const total = chargesTotal(essential) + chargesTotal(discretionary);
    return {
      id: `month-${month}`,
      title: shortMonth(month),
      intro: `What you spent on living costs in ${longMonth(month)}. Mortgage escrow is not in the bars. ${COUNTED}`,
      steps: [
        {
          lines: [chargeLine("+", "Essentials", essential), chargeLine("+", "Discretionary", discretionary)],
          total: { label: `Spent in ${shortMonth(month)}`, value: dollars(total), testId: "month-total" },
        },
      ],
      links: [{ href: "#by-category", label: "Each category, below" }],
    };
  });
}

/** Each trend's months: that category's charges in that month. */
export function categoryMonthBreakdowns(
  trends: CategoryTrend[],
  months: string[],
  find: ChargeFinder,
): Record<string, (Breakdown | null)[]> {
  return Object.fromEntries(
    trends.map((t) => [
      t.category,
      months.map((month) => {
        const charges = find.where(
          (c) => isLiving(c) && c.category === t.category && monthOf(c.tx.date) === month,
          { counted: true },
        );
        if (charges.length === 0) return null;
        return {
          id: `cat-${t.category}-${month}`,
          title: shortMonth(month),
          intro: `${t.label} in ${longMonth(month)}. ${COUNTED}`,
          steps: [
            {
              lines: [chargeLine("+", t.label, charges)],
              total: {
                label: `${t.label}, ${shortMonth(month)}`,
                value: dollars(chargesTotal(charges)),
                testId: "category-month-total",
              },
            },
          ],
          links: [{ href: "/spending#by-category", label: "By category" }],
        };
      }),
    ]),
  );
}

/** Money in and out: the deposits counted as income less living spending, per month. */
export function inOutMonthBreakdowns(s: AnnualSpending, find: ChargeFinder): (Breakdown | null)[] {
  return s.monthly.map(({ month }) => {
    const income = find.where((c) => c.class === "income" && monthOf(c.tx.date) === month);
    const living = find.where((c) => isLiving(c) && monthOf(c.tx.date) === month, { counted: true });
    if (income.length + living.length === 0) return null;
    const inCents = -chargesTotal(income);
    const outCents = chargesTotal(living);
    return {
      id: `inout-${month}`,
      title: shortMonth(month),
      intro: `Income that landed in your connected accounts in ${longMonth(month)}, less what went to living costs. Transfers, card payments, loan payments and investing are in neither.`,
      steps: [
        {
          lines: [
            {
              op: "+",
              label: "Income",
              value: dollars(inCents),
              ...(income.length ? { charges: income, chargesIn: true } : {}),
            },
            chargeLine("-", "Living spending", living),
          ],
          total: {
            label: inCents >= outCents ? `Kept in ${shortMonth(month)}` : `Overspent in ${shortMonth(month)}`,
            value: dollars(inCents - outCents),
            testId: "inout-total",
          },
        },
      ],
      links: [{ href: "/spending", label: "Spending" }],
    };
  });
}

const isDebt = (a: AccountLike | undefined) => a?.type === "credit" || a?.type === "loan";
const countsTowardFi = (a: AccountLike | undefined) =>
  a !== undefined && !isDebt(a) && a.includeInFi && a.bucket !== "excluded";

/**
 * Net worth and money counted toward FI on each snapshot day: every account's
 * balance that day (an account carries its last known balance forward, the same
 * rule balanceHistory uses), owed balances subtracted.
 */
export function balanceDayBreakdowns(
  snaps: SnapshotLike[],
  accounts: (AccountLike & { name: string; mask: string | null })[],
): Breakdown[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const name = (id: string) => {
    const a = byId.get(id);
    return a ? `${a.name}${a.mask ? ` ...${a.mask}` : ""}` : "An account no longer connected";
  };
  const byDate = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    const m = byDate.get(s.asOfDate) ?? new Map<string, number>();
    m.set(s.accountId, s.currentCents);
    byDate.set(s.asOfDate, m);
  }
  const last = new Map<string, { cents: number; date: string }>();
  const out: Breakdown[] = [];
  for (const date of [...byDate.keys()].sort()) {
    for (const [id, cents] of byDate.get(date)!) last.set(id, { cents, date });
    const rows = [...last].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents));
    const carried = (d: string) =>
      d === date ? undefined : `balance from ${dateText(d)}, the last one known`;
    const netLines: BreakdownLine[] = rows.map(([id, v]) => ({
      op: isDebt(byId.get(id)) ? "-" : "+",
      label: name(id),
      value: dollars(v.cents),
      ...(isDebt(byId.get(id))
        ? { detail: carried(v.date) ?? "owed" }
        : carried(v.date)
          ? { detail: carried(v.date) }
          : {}),
    }));
    const counted = rows.filter(([id]) => countsTowardFi(byId.get(id)));
    const net = rows.reduce((s, [id, v]) => s + (isDebt(byId.get(id)) ? -v.cents : v.cents), 0);
    const countedCents = counted.reduce((s, [, v]) => s + v.cents, 0);
    out.push({
      id: `bal-${date}`,
      title: dateText(date),
      intro: `Every account's balance on ${dateText(date)}. Net worth is what you own less what you owe; counted toward FI is only the accounts that fund retirement.`,
      steps: [
        {
          title: "Net worth",
          lines: netLines.length ? netLines : [{ op: "+", label: "No balances", value: 0 }],
          total: { label: "Net worth", value: dollars(net), testId: "bal-net-total" },
        },
        {
          title: "Counted toward FI",
          lines: counted.length
            ? counted.map(([id, v]) => ({ op: "+" as const, label: name(id), value: dollars(v.cents) }))
            : [{ op: "+", label: "No accounts counted toward FI", value: 0 }],
          total: { label: "Counted toward FI", value: dollars(countedCents), testId: "bal-counted-total" },
        },
      ],
      notCounted: rows
        .filter(([id]) => !isDebt(byId.get(id)) && !countsTowardFi(byId.get(id)))
        .map(([id, v]) => ({
          label: name(id),
          value: dollars(v.cents),
          reason: "left out of FI on the Accounts page",
        })),
      links: [{ href: "/accounts", label: "Accounts" }],
    });
  }
  return out;
}
