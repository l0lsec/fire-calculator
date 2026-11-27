// Every bar, point and comparison cell opens what it is made of (docs/UX_PRINCIPLES.md,
// law 19). These tests prove each drill-down adds up to the value the chart or
// table shows, and that its lines carry the real transactions behind it.
import { monthIndex, parseEngineInput } from "@fire/engine/core";
import { simulateDebts } from "@fire/engine/debt";
import { runPlan } from "@fire/engine/levels";
import { FIXTURE_ACCOUNTS, FIXTURE_AS_OF, fixtureTransactions } from "@fire/plaid/fake";
import { deriveSpending, type SpendingInput } from "@fire/spending";
import { describe, expect, it } from "vitest";
import { type Breakdown, evaluateStep } from "../src/lib/breakdown";
import { chargesTotal } from "../src/lib/charges";
import {
  balanceHistory,
  categoryTrends,
  moneyInOut,
  paymentSplit,
  paymentSplitBreakdowns,
  spendingSplitByMonth,
} from "../src/lib/chart-data";
import { chargeFinder } from "../src/server/charges";
import {
  balanceDayBreakdowns,
  categoryMonthBreakdowns,
  inOutMonthBreakdowns,
  spendingMonthBreakdowns,
} from "../src/server/charts/breakdowns";
import { summarize } from "../src/server/compare";
import { scenarioBreakdowns } from "../src/server/compare/breakdowns";
import { dashboardModel } from "../src/server/dashboard";
import { type HouseholdPlan, MEASURED_INCOME_ID } from "../src/server/snapshot";
import { measuredIncomeBreakdown } from "../src/server/spending";

const ACCOUNTS = FIXTURE_ACCOUNTS.map((a) => ({
  id: a.account_id,
  name: a.name,
  mask: a.mask ?? null,
  business: false,
}));

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

const cents = (dollars: number) => Math.round(dollars * 100);

/** Every step's lines produce its total (the panel's dev check, as a test). */
function expectAddsUp(b: Breakdown) {
  for (const s of b.steps) expect(evaluateStep(s)).toBeCloseTo(s.total.value, 2);
}

/** A line's charges add up to the line (money in shows as a positive line). */
function expectLinesMatchCharges(b: Breakdown) {
  for (const s of b.steps)
    for (const l of s.lines)
      if (l.charges?.length) expect(Math.abs(chargesTotal(l.charges))).toBe(Math.abs(cents(l.value)));
}

const s = fixtureSpending();
const find = chargeFinder(s.classified, ACCOUNTS);
const months = s.monthly.map((m) => m.month);

describe("Spending charts", () => {
  it("each month's bar opens essentials and discretionary charges that add up to it", () => {
    const drill = spendingMonthBreakdowns(s, find);
    const split = spendingSplitByMonth(s.classified, months);
    expect(drill).toHaveLength(months.length);
    drill.forEach((b, i) => {
      if (!b) {
        expect(s.monthly[i]!.livingCents).toBe(0);
        return;
      }
      expectAddsUp(b);
      expectLinesMatchCharges(b);
      expect(cents(b.steps[0]!.total.value)).toBe(s.monthly[i]!.livingCents);
      expect(b.steps[0]!.lines[0]!.value).toBeCloseTo(split[i]!.essential, 2);
      expect(b.steps[0]!.lines[1]!.value).toBeCloseTo(split[i]!.discretionary, 2);
    });
    expect(drill.some((b) => b?.steps[0]?.lines.some((l) => l.charges?.length))).toBe(true);
  });

  it("each category trend bar opens that category's charges that month", () => {
    const trends = categoryTrends(s.classified, months, (c) => c, 6);
    const drill = categoryMonthBreakdowns(trends, months, find);
    for (const t of trends) {
      t.months.forEach((m, i) => {
        const b = drill[t.category]![i];
        if (!b) {
          expect(m.value).toBe(0);
          return;
        }
        expectAddsUp(b);
        expectLinesMatchCharges(b);
        expect(b.steps[0]!.total.value).toBeCloseTo(m.value, 2);
      });
    }
  });
});

describe("History charts", () => {
  it("each month of money in and out opens the deposits and charges, and nets to what was kept", () => {
    const drill = inOutMonthBreakdowns(s, find);
    const rows = moneyInOut(s.classified, months);
    drill.forEach((b, i) => {
      const r = rows[i]!;
      if (!b) {
        expect(r.income + r.spending).toBe(0);
        return;
      }
      expectAddsUp(b);
      expectLinesMatchCharges(b);
      expect(b.steps[0]!.lines[0]!.value).toBeCloseTo(r.income, 2);
      expect(b.steps[0]!.lines[1]!.value).toBeCloseTo(r.spending, 2);
      expect(b.steps[0]!.total.value).toBeCloseTo(r.income - r.spending, 2);
    });
    expect(drill.some((b) => b?.steps[0]?.lines[0]?.chargesIn)).toBe(true);
  });

  it("each day's net worth and FI balance opens every account's balance that day", () => {
    const accounts = [
      { id: "chk", name: "Checking", mask: "1234", type: "depository", bucket: "cash", includeInFi: true },
      { id: "brk", name: "Brokerage", mask: null, type: "investment", bucket: "taxable", includeInFi: true },
      { id: "home", name: "Home", mask: null, type: "other", bucket: "excluded", includeInFi: true },
      { id: "kids", name: "Kids", mask: null, type: "investment", bucket: "taxable", includeInFi: false },
      { id: "card", name: "Card", mask: "9", type: "credit", bucket: "cash", includeInFi: true },
    ];
    const snaps = [
      { accountId: "chk", asOfDate: "2026-01-01", currentCents: 10_000 },
      { accountId: "brk", asOfDate: "2026-01-01", currentCents: 50_000 },
      { accountId: "home", asOfDate: "2026-01-01", currentCents: 300_000 },
      { accountId: "kids", asOfDate: "2026-01-01", currentCents: 5_000 },
      { accountId: "card", asOfDate: "2026-01-01", currentCents: 2_000 },
      { accountId: "brk", asOfDate: "2026-01-02", currentCents: 55_000 },
    ];
    const points = balanceHistory(snaps, accounts);
    const days = balanceDayBreakdowns(snaps, accounts);
    expect(days).toHaveLength(points.length);
    days.forEach((b, i) => {
      expectAddsUp(b);
      expect(cents(b.steps[0]!.total.value)).toBe(points[i]!.netWorthCents);
      expect(cents(b.steps[1]!.total.value)).toBe(points[i]!.countedCents);
    });
    // The card is owed; the checking balance on the 2nd is carried from the 1st.
    const second = days[1]!;
    expect(second.steps[0]!.lines.find((l) => l.label === "Card ...9")?.op).toBe("-");
    expect(second.steps[0]!.lines.find((l) => l.label === "Checking ...1234")?.detail).toMatch(
      /last one known/,
    );
    expect(second.notCounted?.map((n) => n.label).sort()).toEqual(["Home", "Kids"]);
  });
});

describe("Debt payment chart", () => {
  const START = monthIndex(2026, 1);
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
        {
          id: "car",
          name: "Car",
          kind: "auto",
          balance: balance / 2,
          apr: 0.06,
          minPayment: { type: "fixed", amount: payment / 2 },
        },
      ],
    });

  for (const [what, balance, payment] of [
    ["monthly", 3000, 200],
    ["yearly", 20_000, 400],
  ] as const) {
    it(`${what}: each bar opens every debt's interest and principal, adding up to the bar`, () => {
      const i = input(balance, payment);
      const r = simulateDebts(i.debts, i.debtPlan, { startMonth: START });
      const split = paymentSplit(r.schedule, START);
      const drill = paymentSplitBreakdowns(r.schedule, START, { card: "Card", car: "Car" });
      expect(split.per).toBe(what === "monthly" ? "month" : "year");
      expect(drill.map((b) => b.title)).toEqual(split.rows.map((x) => x.label));
      drill.forEach((b, k) => {
        expectAddsUp(b);
        expect(b.steps[0]!.total.value).toBeCloseTo(split.rows[k]!.interest, 1);
        expect(b.steps[1]!.total.value).toBeCloseTo(split.rows[k]!.principal, 1);
      });
    });
  }
});

describe("measured take-home pay", () => {
  it("opens each payer's deposits and works out the monthly figure the plan uses", () => {
    const b = measuredIncomeBreakdown(s, find, ACCOUNTS);
    expectAddsUp(b);
    expectLinesMatchCharges(b);
    const last = b.steps[b.steps.length - 1]!;
    expect(last.total.value).toBeCloseTo(s.incomeCents / 12 / 100, 2);
    const deposits = b.steps[0]!.lines.reduce((n, l) => n + (l.charges?.length ?? 0), 0);
    expect(deposits).toBe(s.classified.filter((c) => c.class === "income").length);
  });
});

/** A small plan with measured spending and pay from the fixture transactions. */
function household(): HouseholdPlan {
  const START = monthIndex(2026, 11);
  const input = parseEngineInput({
    startMonth: START,
    people: [{ id: "p1", name: "Sam", birthMonth: START - 40 * 12 }],
    accounts: [
      { id: "chk", name: "Checking", bucket: "cash", balance: 30_000 },
      { id: "brk", name: "Brokerage", bucket: "taxable", balance: 250_000 },
    ],
    debts: [
      {
        id: "card",
        name: "Visa",
        kind: "credit_card",
        balance: 6_000,
        apr: 0.24,
        minPayment: { type: "fixed", amount: 200 },
      },
      {
        id: "car",
        name: "Car loan",
        kind: "auto",
        balance: 14_000,
        apr: 0.06,
        minPayment: { type: "fixed", amount: 420 },
      },
    ],
    income: [
      {
        id: MEASURED_INCOME_ID,
        name: "Take-home pay (measured)",
        kind: "takeHome",
        personId: "p1",
        monthly: 9_000,
        growth: "inflation",
        phase: "working",
      },
    ],
    spending: { currentAnnual: s.livingCents / 100, currentEssentialAnnual: s.livingEssentialCents / 100 },
    debtPlan: { strategy: "avalanche", extraMonthly: 300 },
    policy: "payoffAtFI",
  });
  return {
    input,
    result: runPlan(input),
    issues: [],
    asOf: "2026-11-25",
    scenario: {
      id: "base",
      name: "My plan",
      isBaseline: true,
      extraIncome: [],
      spendingOverrideCents: null,
      assumptions: input.assumptions,
      policy: "payoffAtFI",
    },
    data: { spendingSource: "plaid", derivedSpending: s, measured: s, accounts: ACCOUNTS, debts: [] },
  } as unknown as HouseholdPlan;
}

describe("dashboard", () => {
  const m = dashboardModel(household());

  it("measured spending and pay open the charges and deposits they come from", () => {
    const spending = m.breakdowns!.spending.steps[0]!.lines.find((l) => l.testId === "sp-living")!;
    expect(cents(spending.value)).toBe(s.livingCents);
    expect(chargesTotal(spending.charges ?? [])).toBe(s.livingCents); // a full year: not annualized
    const pay = m.breakdowns!["savings-rate"].steps[0]!.lines.find((l) => l.testId === "sr-income")!;
    expect(pay.chargesIn).toBe(true);
    expect(pay.charges?.length).toBe(s.classified.filter((c) => c.class === "income").length);
    const fi = m.breakdowns!["fi-number"];
    expect(fi.steps.some((st) => st.lines.some((l) => l.charges?.length))).toBe(true);
  });

  it("each month's income bar opens income less spending, escrow and interest, equal to saved", () => {
    expect(m.incomeByMonthDrill).toHaveLength(m.incomeByMonth.length);
    m.incomeByMonthDrill.forEach((b, i) => {
      expectAddsUp(b);
      expect(b.steps[0]!.total.value).toBeCloseTo(m.incomeByMonth[i]!.saved, 2);
    });
  });
});

describe("Scenarios comparison", () => {
  const plan = household();
  const summary = summarize("base", "My plan", true, plan.input, plan.result, [], { mcRuns: 20 });
  const cells = scenarioBreakdowns(plan, summary);

  it("every figure in the table opens a breakdown that adds up to it", () => {
    for (const b of Object.values(cells)) expectAddsUp(b!);
    expect(cells["fi-number"]!.steps.at(-1)!.total.value).toBeCloseTo(summary.fiTarget!, 2);
    expect(cells.interest!.steps[0]!.total.value).toBeCloseTo(summary.totalInterest!, 2);
    expect(cells.interest!.steps[0]!.lines.map((l) => l.label).sort()).toEqual(["Car loan", "Visa"]);
    expect(cells.simulated!.steps[0]!.total.value).toBeCloseTo(summary.successRate!, 6);
    if (summary.historicalSuccess !== null)
      expect(cells.historical!.steps[1]!.total.value).toBeCloseTo(summary.historicalSuccess, 6);
  });

  it("keeps breakdown ids unique per scenario", () => {
    for (const b of Object.values(cells)) expect(b!.id.startsWith("base-")).toBe(true);
  });
});
