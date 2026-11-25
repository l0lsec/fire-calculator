import { describe, expect, it } from "vitest";
import { type EngineInputDraft, monthIndex, parseEngineInput } from "../../src/core";
import { runPlan, targetsAt } from "../../src/levels";
import { project } from "../../src/projection";
import { accessibleFI, blendedWithdrawalTax } from "../../src/withdrawal";

const START = monthIndex(2026, 1);

function draft(
  age: number,
  accounts: EngineInputDraft["accounts"],
  over: Partial<EngineInputDraft> = {},
): EngineInputDraft {
  return {
    startMonth: START,
    people: [{ id: "p1", name: "Alex", birthMonth: START - age * 12 }],
    accounts,
    income: [
      {
        id: "pay",
        name: "Pay",
        kind: "takeHome",
        personId: "p1",
        monthly: 5000,
        growth: "none",
        phase: "working",
      },
    ],
    spending: { currentAnnual: 60000, currentEssentialAnnual: 40000 },
    assumptions: {
      nominalReturn: 0.05,
      inflation: 0,
      raiseRate: 0,
      swr: 0.04,
      withdrawalTaxRate: 0,
      emergencyMonths: 0,
    },
    ...over,
  };
}

describe("accessible FI", () => {
  it("FI at 45 all in traditional fails; a 5-year ladder started at FI passes from year 5", () => {
    const input = parseEngineInput(
      draft(45, [{ id: "k", name: "401k", bucket: "traditional", balance: 2_000_000 }]),
    );
    const r = runPlan(input);
    expect(r.fiK).toBe(0);
    const none = accessibleFI(r);
    expect(none.applies).toBe(true);
    expect(none.ok).toBe(false);
    expect(none.gapYears).toBeCloseTo(14.5, 9);
    expect(none.coveredFromYear).toBeNull();

    const ladder = accessibleFI(r, { ladder: { annualConversion: 70_000 } });
    expect(ladder.ok).toBe(false);
    expect(ladder.uncoveredMonths).toBe(60);
    expect(ladder.coveredFromYear).toBe(5);
  });

  it("taxable money and Roth contribution basis bridge the gap; Rule of 55 opens traditional money", () => {
    const bridged = parseEngineInput(
      draft(45, [
        { id: "k", name: "401k", bucket: "traditional", balance: 1_200_000 },
        { id: "b", name: "Brokerage", bucket: "taxable", balance: 600_000 },
        { id: "r", name: "Roth", bucket: "roth", balance: 300_000, rothContributionBasis: 250_000 },
      ]),
    );
    const ok = accessibleFI(runPlan(bridged));
    expect(ok.ok).toBe(true);
    expect(ok.coveredFromYear).toBe(0);
    expect(ok.accessibleAtFI).toBe(850_000);

    const at56 = runPlan(
      parseEngineInput(draft(56, [{ id: "k", name: "401k", bucket: "traditional", balance: 2_000_000 }])),
    );
    expect(accessibleFI(at56).ok).toBe(false);
    expect(accessibleFI(at56, { ruleOf55: true }).ok).toBe(true);

    const at62 = runPlan(
      parseEngineInput(draft(62, [{ id: "k", name: "401k", bucket: "traditional", balance: 2_000_000 }])),
    );
    expect(accessibleFI(at62).applies).toBe(false);
  });
});

describe("social security", () => {
  it("Social Security lowers the target only from the claim age onward", () => {
    const ss = {
      id: "ss",
      name: "Social Security",
      kind: "socialSecurity" as const,
      personId: "p1",
      monthly: 2000,
      phase: "retired" as const,
      startAge: 67,
    };
    const base = draft(64, [{ id: "b", name: "B", bucket: "taxable", balance: 1_000_000 }], {
      assumptions: { ...draft(0, []).assumptions, countGuaranteedIncome: true },
    });
    const without = parseEngineInput(base);
    const withSS = parseEngineInput({ ...base, income: [...(base.income ?? []), ss] });
    const accA = project(without, { neverRetire: true });
    const accB = project(withSS, { neverRetire: true });
    // Before 67 (age 64 + 2 years): unchanged.
    expect(targetsAt(withSS, accB, accB.rows[24]!).fi).toBeCloseTo(
      targetsAt(without, accA, accA.rows[24]!).fi,
      9,
    );
    // At 67 and after: lower by exactly SS / w.
    for (const k of [36, 60]) {
      expect(
        targetsAt(without, accA, accA.rows[k]!).fi - targetsAt(withSS, accB, accB.rows[k]!).fi,
      ).toBeCloseTo(24000 / 0.04, 6);
    }

    // In the drawdown, withdrawals drop at the claim month.
    const plan = project(withSS, { retireAtK: 0 });
    const w = (k: number) => plan.rows[k]!.withdrawals;
    expect(w(35)).toBeCloseTo(5000, 6);
    // Month k is the 67th birthday month when start + k - 1 = birth + 67*12, i.e. k = 37.
    expect(w(37)).toBeCloseTo(3000, 6);
  });
});

describe("blended withdrawal tax", () => {
  it("weights ordinary and gains rates by bucket balance and cost basis", () => {
    const t = blendedWithdrawalTax(
      [
        { id: "k", name: "401k", bucket: "traditional", balance: 500_000, includeInFI: true },
        {
          id: "b",
          name: "Brokerage",
          bucket: "taxable",
          balance: 300_000,
          costBasis: 150_000,
          includeInFI: true,
        },
        { id: "r", name: "Roth", bucket: "roth", balance: 200_000, includeInFI: true },
        { id: "h", name: "House", bucket: "excluded", balance: 900_000, includeInFI: false },
      ],
      { ordinary: 0.12, capitalGains: 0.15 },
    );
    // (500k * 12% + 300k * 50% * 15%) / 1,000k = (60,000 + 22,500) / 1,000,000
    expect(t).toBeCloseTo(0.0825, 12);
    expect(blendedWithdrawalTax([])).toBe(0);
  });
});
