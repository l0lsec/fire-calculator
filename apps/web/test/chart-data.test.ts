// The chart rows must add up to the figures the rest of the app shows: a chart
// that disagrees with its own page is worse than no chart.
import { monthIndex, parseEngineInput } from "@fire/engine/core";
import { simulateDebts } from "@fire/engine/debt";
import { FIXTURE_ACCOUNTS, FIXTURE_AS_OF, fixtureTransactions } from "@fire/plaid/fake";
import { deriveSpending, type SpendingInput } from "@fire/spending";
import { describe, expect, it } from "vitest";
import {
  balanceHistory,
  categoryTrends,
  moneyInOut,
  paymentSplit,
  scenarioBars,
  shortMonth,
  spendingSplitByMonth,
} from "../src/lib/chart-data";

function fixtureSpending() {
  const input: SpendingInput = {
    asOf: FIXTURE_AS_OF,
    accounts: FIXTURE_ACCOUNTS.map((a) => ({ id: a.account_id, type: a.type, subtype: a.subtype })),
    transactions: fixtureTransactions().map((t) => ({
      id: t.transaction_id,
      accountId: t.account_id,
      date: t.date,
      amountCents: Math.round(t.amount * 100),
      name: t.name,
      merchant: t.merchant_name ?? null,
      pfcPrimary: t.personal_finance_category?.primary ?? null,
      pfcDetailed: t.personal_finance_category?.detailed ?? null,
      pending: t.pending,
    })),
  };
  return deriveSpending(input);
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const cents = (dollars: number) => Math.round(dollars * 100);

describe("spending charts", () => {
  const s = fixtureSpending();
  const months = s.monthly.map((m) => m.month);

  it("labels months short", () => {
    expect(shortMonth("2026-03")).toBe("Mar 26");
    expect(shortMonth("2025-12")).toBe("Dec 25");
  });

  it("essential plus discretionary is each month's living spending, and the year adds up", () => {
    const split = spendingSplitByMonth(s.classified, months);
    expect(split).toHaveLength(12);
    split.forEach((r, i) => {
      expect(cents(r.essential + r.discretionary)).toBe(s.monthly[i]!.livingCents);
    });
    // Twelve full months, so nothing is annualized: the sums are the annual figures.
    expect(s.monthsOfData).toBe(12);
    expect(cents(sum(split.map((r) => r.essential)))).toBe(s.livingEssentialCents);
    expect(cents(sum(split.map((r) => r.discretionary)))).toBe(s.livingCents - s.livingEssentialCents);
  });

  it("category trends keep the largest categories, each summing to its category total", () => {
    const trends = categoryTrends(s.classified, months, (c) => `label:${c}`, 3);
    expect(trends.length).toBeLessThanOrEqual(3);
    expect(trends.length).toBeGreaterThan(1);
    for (let i = 1; i < trends.length; i++)
      expect(trends[i - 1]!.total).toBeGreaterThanOrEqual(trends[i]!.total);
    for (const t of trends) {
      const cat = s.byCategory.find((c) => c.category === t.category)!;
      expect(cents(t.total)).toBe(cat.totalCents);
      expect(cents(sum(t.months.map((m) => m.value)))).toBe(cat.totalCents);
      expect(t.months).toHaveLength(12);
      expect(t.label).toBe(`label:${t.category}`);
    }
    // The first trend is the largest category on the By category list.
    expect(trends[0]!.category).toBe(s.byCategory[0]!.category);
  });

  it("money in and out matches measured income and living spending", () => {
    const rows = moneyInOut(s.classified, months);
    rows.forEach((r, i) => {
      expect(cents(r.spending)).toBe(s.monthly[i]!.livingCents);
    });
    expect(cents(sum(rows.map((r) => r.income)))).toBe(s.incomeCents);
  });

  it("ignores transactions outside the months shown", () => {
    const outside = [
      {
        tx: { date: "2020-01-15", amountCents: 999_99 },
        class: "living_expense",
        essential: true,
        category: "X",
        countedCents: 999_99,
      },
    ];
    expect(spendingSplitByMonth(outside, ["2026-01"])).toEqual([
      { month: "Jan 26", essential: 0, discretionary: 0 },
    ]);
    expect(categoryTrends(outside, ["2026-01"], (c) => c)).toEqual([]);
  });
});

describe("balance history", () => {
  const accounts = [
    { id: "chk", type: "depository", bucket: "cash", includeInFi: true },
    { id: "brk", type: "investment", bucket: "taxable", includeInFi: true },
    { id: "home", type: "other", bucket: "excluded", includeInFi: true },
    { id: "kids", type: "investment", bucket: "taxable", includeInFi: false },
    { id: "card", type: "credit", bucket: "cash", includeInFi: true },
  ];

  it("carries balances forward, subtracts debts from net worth and counts only FI accounts", () => {
    const points = balanceHistory(
      [
        { accountId: "chk", asOfDate: "2026-01-01", currentCents: 10_000 },
        { accountId: "brk", asOfDate: "2026-01-01", currentCents: 50_000 },
        { accountId: "home", asOfDate: "2026-01-01", currentCents: 300_000 },
        { accountId: "kids", asOfDate: "2026-01-01", currentCents: 5_000 },
        { accountId: "card", asOfDate: "2026-01-01", currentCents: 2_000 },
        // Only the brokerage reports on the 2nd; the rest carry forward.
        { accountId: "brk", asOfDate: "2026-01-02", currentCents: 55_000 },
      ],
      accounts,
    );
    expect(points).toEqual([
      { date: "2026-01-01", netWorthCents: 10_000 + 50_000 + 300_000 + 5_000 - 2_000, countedCents: 60_000 },
      { date: "2026-01-02", netWorthCents: 10_000 + 55_000 + 300_000 + 5_000 - 2_000, countedCents: 65_000 },
    ]);
  });
});

describe("scenario bars", () => {
  const start = monthIndex(2026, 11);
  it("gives years until FI with the month, the FI number, and says why a scenario is missing", () => {
    const bars = scenarioBars([
      { name: "Baseline", ready: true, fiTarget: 1_200_000, startMonth: start, months: { fi: 150 } },
      { name: "Retire early", ready: true, fiTarget: 1_500_000, startMonth: start, months: { fi: null } },
      { name: "Already there", ready: true, fiTarget: 900_000, startMonth: start, months: { fi: 0 } },
      { name: "Draft", ready: false, fiTarget: null, startMonth: null, months: { fi: null } },
    ]);
    expect(bars.fiDate).toEqual([
      { name: "Baseline", value: 12.5, text: "May 2039, in 12 yr 6 mo" },
      { name: "Already there", value: 0, text: "reached" },
    ]);
    expect(bars.fiNumber.map((b) => [b.name, b.value])).toEqual([
      ["Baseline", 1_200_000],
      ["Retire early", 1_500_000],
      ["Already there", 900_000],
    ]);
    expect(bars.missing).toEqual([
      { name: "Retire early", reason: "FI not within the plan" },
      { name: "Draft", reason: "needs setup" },
    ]);
  });
});

describe("payment split", () => {
  const START = monthIndex(2026, 11);
  const input = (balance: number, payment: number) =>
    parseEngineInput({
      startMonth: START,
      people: [{ id: "p1", name: "Sam", birthMonth: START - 35 * 12 }],
      spending: { currentAnnual: 40_000, currentEssentialAnnual: 30_000 },
      debts: [
        {
          id: "card",
          name: "Card",
          kind: "credit_card",
          balance,
          apr: 0.2,
          minPayment: { type: "fixed", amount: payment },
        },
      ],
    });

  it("monthly: interest is the schedule's interest and principal repays the balance", () => {
    const i = input(3000, 200);
    const r = simulateDebts(i.debts, i.debtPlan, { startMonth: START });
    expect(r.paidOff).toBe(true);
    const split = paymentSplit(r.schedule, START);
    expect(split.per).toBe("month");
    expect(split.rows).toHaveLength(r.schedule.length);
    expect(sum(split.rows.map((x) => x.interest))).toBeCloseTo(r.totalInterest, 1);
    expect(sum(split.rows.map((x) => x.principal))).toBeCloseTo(3000, 1);
    expect(split.rows[0]!.interest).toBeGreaterThan(split.rows[split.rows.length - 2]!.interest);
  });

  it("a long schedule is summed by calendar year with the same totals", () => {
    const i = input(20_000, 400);
    const r = simulateDebts(i.debts, i.debtPlan, { startMonth: START });
    expect(r.schedule.length).toBeGreaterThan(36);
    const split = paymentSplit(r.schedule, START);
    expect(split.per).toBe("year");
    expect(split.rows[0]!.label).toBe("2026");
    expect(sum(split.rows.map((x) => x.interest))).toBeCloseTo(r.totalInterest, 1);
    expect(sum(split.rows.map((x) => x.principal))).toBeCloseTo(20_000, 1);
  });
});
