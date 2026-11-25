import { describe, expect, it } from "vitest";
import { ageAtK, flowsAt, guaranteedIncomeAt, retirementSpendingAt } from "../../src/cashflow";
import { type EngineInputDraft, monthIndex, parseEngineInput } from "../../src/core";
import { paymentAt, simulateDebts } from "../../src/debt";

const START = monthIndex(2026, 1);

function draft(over: Partial<EngineInputDraft> = {}): EngineInputDraft {
  return {
    startMonth: START,
    // Turns 60 at START + 12, so 65 at START + 72.
    people: [{ id: "p1", name: "Alex", birthMonth: START - 59 * 12 }],
    spending: { currentAnnual: 48000, currentEssentialAnnual: 30000 },
    assumptions: { inflation: 0, raiseRate: 0 },
    ...over,
  };
}

describe("escrow", () => {
  it("escrow continues after the mortgage payoff month while P&I stops", () => {
    const input = parseEngineInput(
      draft({
        debts: [
          {
            id: "mtg",
            name: "Mortgage",
            kind: "mortgage",
            balance: 2000,
            apr: 0.06,
            minPayment: { type: "fixed", amount: 1000 },
            escrowMonthly: 400,
          },
        ],
      }),
    );
    const debt = simulateDebts(input.debts, input.debtPlan, { startMonth: START });
    expect(debt.months).toBe(3);
    // P&I flows in month 1, stops after payoff.
    expect(paymentAt(debt, 1)).toBe(1000);
    expect(paymentAt(debt, 4)).toBe(0);
    for (const k of [1, 2, 3, 4, 12, 240]) {
      const f = flowsAt(input, k, false);
      expect(f.escrow).toBe(400);
      expect(f.livingExpenses).toBe(4000 + 400);
      expect(f.essentialExpenses).toBe(2500 + 400);
    }
    // And in retirement.
    expect(flowsAt(input, 300, true).escrow).toBe(400);
    expect(retirementSpendingAt(input, 70).total).toBe(48000 + 4800);
  });

  it("escrow inflates with prices", () => {
    const input = parseEngineInput(
      draft({
        assumptions: { inflation: 0.03, raiseRate: 0 },
        debts: [
          {
            id: "mtg",
            name: "Mortgage",
            kind: "mortgage",
            balance: 0,
            apr: 0.06,
            minPayment: { type: "fixed", amount: 0 },
            escrowMonthly: 400,
          },
        ],
      }),
    );
    expect(flowsAt(input, 12, false).escrow).toBeCloseTo(412, 9);
  });
});

describe("windows", () => {
  const input = parseEngineInput(
    draft({
      income: [
        { id: "pay", name: "Salary", kind: "takeHome", personId: "p1", monthly: 6000, phase: "working" },
        {
          id: "pt",
          name: "Part-time",
          kind: "partTime",
          personId: "p1",
          monthly: 1500,
          phase: "retired",
          endAge: 63,
        },
        {
          id: "ss",
          name: "Social Security",
          kind: "socialSecurity",
          personId: "p1",
          monthly: 2200,
          phase: "retired",
          startAge: 67,
        },
      ],
      spending: {
        currentAnnual: 48000,
        currentEssentialAnnual: 30000,
        retirementAdjustments: [
          {
            id: "aca",
            label: "Health insurance until Medicare",
            annual: 9600,
            essential: true,
            untilAge: 65,
          },
          { id: "commute", label: "No commute", annual: -2400, essential: false },
        ],
      },
    }),
  );

  it("health cost stops in the month the person turns 65 and part-time income respects its window", () => {
    // START + 72 is the 65th birthday month: k = 73.
    expect(ageAtK(input, 73)).toBe(65);
    const before = flowsAt(input, 72, true);
    const at65 = flowsAt(input, 73, true);
    expect(before.livingExpenses).toBeCloseTo((48000 + 9600 - 2400) / 12, 9);
    expect(at65.livingExpenses).toBeCloseTo((48000 - 2400) / 12, 9);
    expect(before.essentialExpenses).toBeCloseTo((30000 + 9600) / 12, 9);

    // Part-time: retired phase only, ends at 63 (k = 49 is age 63).
    expect(flowsAt(input, 10, false).income).toBe(6000);
    expect(flowsAt(input, 48, true).income).toBe(1500);
    expect(flowsAt(input, 49, true).income).toBe(0);
    // Social Security from 67 (k = 97).
    expect(flowsAt(input, 96, true).guaranteedIncome).toBe(0);
    expect(flowsAt(input, 97, true).guaranteedIncome).toBe(2200);
    expect(guaranteedIncomeAt(input, 66.9)).toBe(0);
    expect(guaranteedIncomeAt(input, 67)).toBe(2200 * 12);
  });

  it("contributions are paid only while working and grow with raises", () => {
    const withContrib = parseEngineInput(
      draft({
        assumptions: { inflation: 0, raiseRate: 0.05 },
        contributions: [{ id: "k401", name: "401(k)", bucket: "traditional", monthly: 1000 }],
      }),
    );
    expect(flowsAt(withContrib, 1, false).contributions.traditional).toBeCloseTo(1000 * 1.05 ** (1 / 12), 9);
    expect(flowsAt(withContrib, 12, false).contributions.traditional).toBeCloseTo(1050, 9);
    expect(flowsAt(withContrib, 13, true).contributionTotal).toBe(0);
  });
});
