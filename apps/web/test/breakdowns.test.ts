// Every dashboard number opens a breakdown. These tests prove the lines on screen
// produce the figure on the tile, for households that exercise every kind of line.
import { monthIndex, parseEngineInput } from "@fire/engine/core";
import { runPlan } from "@fire/engine/levels";
import type { AnnualSpending } from "@fire/spending";
import { describe, expect, it } from "vitest";
import { type Breakdown, evaluateStep, foldSlices } from "../src/lib/breakdown";
import { dashboardModel } from "../src/server/dashboard";
import { accountsBreakdown, debtsBreakdowns } from "../src/server/dashboard/breakdowns";
import { type HouseholdPlan, MEASURED_INCOME_ID } from "../src/server/snapshot";
import { spendingBreakdowns } from "../src/server/spending";

const START = monthIndex(2026, 11);

interface Variant {
  name: string;
  policy: "payoffAtFI" | "keepMortgage" | "debtFreeFirst";
  cash: number;
  age: number;
  tax: number;
  countGuaranteed: boolean;
  fatAnnual?: number;
}

function household(v: Variant): HouseholdPlan {
  const input = parseEngineInput({
    startMonth: START,
    people: [{ id: "p1", name: "Sam", birthMonth: START - v.age * 12 }],
    accounts: [
      { id: "chk", name: "Checking", bucket: "cash", balance: v.cash },
      { id: "brk", name: "Brokerage", bucket: "taxable", balance: 180_000 },
      { id: "k401", name: "401k", bucket: "traditional", balance: 240_000 },
      { id: "roth", name: "Roth IRA", bucket: "roth", balance: 60_000 },
      { id: "hsa", name: "HSA", bucket: "hsa", balance: 12_000 },
      { id: "home", name: "Home", bucket: "excluded", balance: 450_000, includeInFI: false },
      { id: "kids", name: "Kids account", bucket: "taxable", balance: 9_000, includeInFI: false },
    ],
    debts: [
      {
        id: "mtg",
        name: "Mortgage",
        kind: "mortgage",
        balance: 300_000,
        apr: 0.04,
        minPayment: { type: "fixed", amount: 1_900 },
        escrowMonthly: 450,
      },
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
        monthly: 9_500,
        growth: "inflation",
        phase: "working",
      },
      {
        id: "side",
        name: "Side work",
        kind: "other",
        personId: "p1",
        monthly: 800,
        growth: "raise",
        phase: "working",
      },
      {
        id: "pension",
        name: "Pension",
        kind: "pension",
        personId: "p1",
        monthly: 1_500,
        growth: "inflation",
        phase: "retired",
        startAge: 60,
      },
    ],
    contributions: [
      { id: "c401", name: "401k from pay", bucket: "traditional", monthly: 1_500, growth: "raise" },
    ],
    spending: {
      currentAnnual: 72_000,
      currentEssentialAnnual: 45_000,
      retirementAdjustments: [
        { id: "hc", label: "Health insurance", annual: 9_000, essential: true, fromAge: 30, untilAge: 65 },
        { id: "commute", label: "No commuting", annual: -3_000 },
        { id: "travel", label: "Travel later", annual: 6_000, fromAge: 70 },
      ],
    },
    debtPlan: { strategy: "avalanche", extraMonthly: 300 },
    policy: v.policy,
    assumptions: {
      nominalReturn: 0.07,
      inflation: 0.03,
      raiseRate: 0.02,
      swr: 0.04,
      retirementAge: 60,
      emergencyMonths: 6,
      withdrawalTaxRate: v.tax,
      countGuaranteedIncome: v.countGuaranteed,
      partTime: { annualNet: 20_000 },
      ...(v.fatAnnual ? { fatAnnual: v.fatAnnual } : {}),
    },
  });
  return {
    input,
    result: runPlan(input),
    issues: [],
    asOf: "2026-11-25",
    scenario: {
      name: "My plan",
      extraIncome: [],
      spendingOverrideCents: null,
      assumptions: input.assumptions,
      policy: v.policy,
    },
    data: {
      spendingSource: "plaid",
      derivedSpending: null,
      debts: [
        { id: "mtg", name: "Mortgage", apr: 0.04, balanceCents: 300_000_00 },
        { id: "store", name: "Store card", apr: null, balanceCents: 1_200_00 },
      ],
    },
  } as unknown as HouseholdPlan;
}

const VARIANTS: Variant[] = [
  {
    name: "cash above the reserve",
    policy: "payoffAtFI",
    cash: 60_000,
    age: 42,
    tax: 0.15,
    countGuaranteed: false,
  },
  {
    name: "cash below the reserve",
    policy: "keepMortgage",
    cash: 3_000,
    age: 42,
    tax: 0,
    countGuaranteed: false,
  },
  {
    name: "debt-free first, older",
    policy: "debtFreeFirst",
    cash: 40_000,
    age: 62,
    tax: 0.1,
    countGuaranteed: true,
  },
  {
    name: "guaranteed income above spending",
    policy: "keepMortgage",
    cash: 40_000,
    age: 66,
    tax: 0.12,
    countGuaranteed: true,
    fatAnnual: 150_000,
  },
];

const last = (b: Breakdown) => b.steps[b.steps.length - 1]?.total.value;

function expectStepsAddUp(b: Breakdown) {
  for (const [i, step] of b.steps.entries()) {
    expect(evaluateStep(step), `${b.id} step ${i + 1} (${step.total.label})`).toBeCloseTo(
      step.total.value,
      6,
    );
  }
}

describe.each(VARIANTS)("dashboard breakdowns: $name", (v) => {
  const plan = household(v);
  const m = dashboardModel(plan);
  const h = m.headline!;
  const tiles = m.breakdowns!;

  it("every step's lines evaluate to its total", () => {
    for (const b of Object.values(tiles)) expectStepsAddUp(b);
    for (const l of m.ladder) expectStepsAddUp(l.breakdown);
  });

  it("each tile's breakdown ends on the tile's figure", () => {
    expect(last(tiles["fi-number"])).toBeCloseTo(h.fiTarget, 6);
    expect(last(tiles.invested)).toBeCloseTo(h.portfolio, 6);
    expect(last(tiles["net-worth"])).toBeCloseTo(h.netWorth, 6);
    expect(last(tiles.spending)).toBeCloseTo(h.spendingAnnual, 6);
    expect(last(tiles["savings-rate"])).toBeCloseTo(h.savingsRate!, 9);
    if (h.fiTarget > h.portfolio) expect(last(tiles["fi-date"])).toBeCloseTo(h.fiTarget - h.portfolio, 6);
  });

  it("the savings rate is the same figure the dashboard showed before breakdowns", () => {
    const acc = plan.result!.accumulation;
    let gross = 0;
    let out = 0;
    for (let k = 1; k <= 12; k++) {
      const row = acc.rows[k]!;
      gross += row.income + row.contributions;
      out += row.livingExpenses + (acc.debt.schedule[k - 1]?.totalInterest ?? 0);
    }
    expect(h.savingsRate).toBeCloseTo((gross - out) / gross, 9);
    expect(h.incomeFirstYear).toBeCloseTo(gross, 6);
  });

  it("each ladder row's breakdown builds its target (or its debt balance)", () => {
    for (const l of m.ladder) {
      const totals = l.breakdown.steps.map((s) => s.total.value);
      if (l.isDebt) {
        if (l.current > 0) expect(totals[0], l.id).toBeCloseTo(l.current, 6);
      } else if (l.id !== "barista") {
        expect(
          totals.some((t) => Math.abs(t - l.target) < 1e-6),
          `${l.id}: ${totals.join(", ")} vs ${l.target}`,
        ).toBe(true);
      }
    }
  });

  it("each donut's slices add up to the figure it splits", () => {
    const sum = (b: Breakdown) => (b.chart?.slices ?? []).reduce((s, x) => s + x.value, 0);
    expect(sum(tiles.invested)).toBeCloseTo(h.portfolio, 6);
    expect(sum(tiles["fi-number"])).toBeCloseTo(h.fiTarget, 6);
    expect(sum(tiles["net-worth"])).toBeCloseTo(
      plan.input!.accounts.reduce((s, a) => s + a.balance, 0),
      6,
    );
    if (h.savingsRate! > 0) expect(sum(tiles["savings-rate"])).toBeCloseTo(h.incomeFirstYear, 6);
    expect(sum(tiles.spending)).toBeCloseTo(h.spendingAnnual, 6);
    for (const b of Object.values(tiles)) expect(b.chart?.slices.length ?? 0, b.id).toBeLessThanOrEqual(5);
  });

  it("names what is left out and why", () => {
    const left = tiles.invested.notCounted?.map((n) => n.label);
    expect(left).toEqual(["Home", "Kids account"]);
    expect(tiles["net-worth"].notCounted?.map((n) => n.label)).toEqual(["Store card"]);
    // Every breakdown says where its inputs are changed.
    for (const b of Object.values(tiles)) expect(b.links.length, b.id).toBeGreaterThan(0);
  });
});

describe("dashboard breakdowns: details", () => {
  it("the reserve line takes all the cash when cash is below the reserve", () => {
    const m = dashboardModel(household(VARIANTS[1]!));
    const reserve = m.breakdowns!.invested.steps[0]!.lines.find((l) => l.testId === "inv-reserve");
    expect(reserve?.value).toBe(3_000);
    expect(reserve?.detail).toMatch(/none of it counts/);
  });

  it("guaranteed income is counted only up to spending", () => {
    const m = dashboardModel(household(VARIANTS[3]!));
    const step = m.breakdowns!["fi-number"].steps[1]!;
    const g = step.lines.find((l) => l.label === "Social Security and pensions");
    expect(g?.detail).toBeDefined();
    expect(evaluateStep(step)).toBeCloseTo(m.headline!.fiTarget, 6);
  });
});

describe("foldSlices", () => {
  it("keeps the four largest parts, folds the rest into Other, and drops non-positive parts", () => {
    const s = foldSlices([
      { label: "a", value: 1 },
      { label: "b", value: 5 },
      { label: "c", value: 3 },
      { label: "d", value: 4 },
      { label: "e", value: 2 },
      { label: "f", value: 0.5 },
      { label: "g", value: -9 },
    ]);
    expect(s.map((x) => x.label)).toEqual(["b", "d", "c", "e", "Other"]);
    expect(s[4]).toEqual({ label: "Other", value: 1.5, other: true });
  });
});

describe("other pages' breakdowns", () => {
  it("Accounts: Counting toward FI adds up and names what is left out", () => {
    const b = accountsBreakdown([
      { id: "a", name: "Checking", bucket: "cash", currentCents: 1_234_56, includeInFi: true },
      { id: "b", name: "401k", bucket: "traditional", currentCents: 50_000_00, includeInFi: true },
      { id: "c", name: "Car", bucket: "excluded", currentCents: 9_000_00, includeInFi: false },
      { id: "d", name: "Kids", bucket: "taxable", currentCents: 3_000_00, includeInFi: false },
    ]);
    expectStepsAddUp(b);
    expect(last(b)).toBeCloseTo(51_234.56, 6);
    expect(b.notCounted?.map((n) => n.label)).toEqual(["Car", "Kids"]);
    expect(b.chart?.slices.reduce((s, x) => s + x.value, 0)).toBeCloseTo(51_234.56, 6);
  });

  it("Debts: total owed, what is left out, and the FI-number part match the plan", () => {
    const plan = household(VARIANTS[1]!);
    const { owed, fi } = debtsBreakdowns(plan);
    expectStepsAddUp(owed);
    expect(owed.steps[0]?.total.value).toBeCloseTo(301_200, 6);
    expect(last(owed)).toBeCloseTo(300_000, 6);
    expectStepsAddUp(fi!);
    expect(last(fi!)).toBeCloseTo(plan.result!.levels.debt, 6);
  });

  it("Spending: each tile's steps add up to the measured totals", () => {
    const s = {
      windowStart: "2025-11-01",
      windowEnd: "2026-10-31",
      monthsOfData: 12,
      livingCents: 60_000_00,
      livingEssentialCents: 38_000_00,
      escrowCents: 5_400_00,
      totalCents: 65_400_00,
      essentialCents: 43_400_00,
      discretionaryCents: 22_000_00,
      businessCents: 4_000_00,
      byCategory: [
        {
          category: "FOOD_AND_DRINK_GROCERIES",
          primary: "FOOD_AND_DRINK",
          essential: true,
          totalCents: 30_000_00,
        },
        { category: "TRAVEL_FLIGHTS", primary: "TRAVEL", essential: false, totalCents: 30_000_00 },
      ],
    } as unknown as AnnualSpending;
    const b = spendingBreakdowns(s);
    for (const x of Object.values(b)) expectStepsAddUp(x);
    expect(last(b.annual)).toBe(60_000); // "Who spent it": personal + business = living spending
    expect(b.annual.steps[0]?.total.value).toBe(65_400);
    expect(last(b.essentials)).toBe(43_400);
    expect(last(b.discretionary)).toBe(22_000);
    expect(b.annual.chart?.slices.reduce((t, x) => t + x.value, 0)).toBe(65_400);
  });
});
