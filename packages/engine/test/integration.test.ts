import { describe, expect, it } from "vitest";
import { monthIndex, parseEngineInput } from "../src/core";
import { runPlan } from "../src/levels";
import { workedExample } from "./fixture";

const START = monthIndex(2026, 1);

describe("engine integration", () => {
  it("the worked example with its debts under the default policy is coherent end to end", () => {
    const ex = workedExample();
    const i = ex.inputs;
    const budget = i.debts.reduce((s, d) => s + d.minPayment, 0) + i.extraDebtPayment;
    const input = parseEngineInput({
      startMonth: START,
      people: [{ id: "p1", name: "Alex", birthMonth: START - i.age * 12 }],
      accounts: [{ id: "brk", name: "Brokerage", bucket: "taxable", balance: i.portfolio }],
      debts: i.debts.map((d) => ({
        id: d.name,
        name: d.name,
        kind: "other",
        balance: d.balance,
        apr: d.apr,
        minPayment: { type: "fixed", amount: d.minPayment },
      })),
      income: [
        {
          id: "pay",
          name: "Pay",
          kind: "takeHome",
          personId: "p1",
          // Keeps investing the same 2000 a month while servicing the debt budget.
          monthly: i.annualExpenses / 12 + i.monthlyContribution + budget,
          growth: "none",
          phase: "working",
        },
      ],
      spending: { currentAnnual: i.annualExpenses, currentEssentialAnnual: i.essentialExpenses },
      debtPlan: { strategy: "avalanche", extraMonthly: i.extraDebtPayment },
      assumptions: {
        nominalReturn: i.realReturn,
        inflation: 0,
        raiseRate: 0,
        swr: i.swr,
        retirementAge: i.retirementAge,
        emergencyMonths: 0,
        withdrawalTaxRate: 0,
      },
    });
    const r = runPlan(input);
    const totalDebt = i.debts.reduce((s, d) => s + d.balance, 0);
    expect(r.levels.fi).toBeCloseTo(ex.expected.fi + totalDebt, 6);
    expect(r.accumulation.debt.months).toBe(ex.expected.avalanche.months);
    expect(Math.round(r.accumulation.debt.totalInterest * 100) / 100).toBe(
      ex.expected.avalanche.totalInterest,
    );
    const byId = Object.fromEntries(r.ladder.map((l) => [l.id, l]));
    expect(byId.consumerDebtFree?.reachedK).toBe(42);
    expect(byId.highInterestDebtFree?.reachedK).toBe(15);
    // Once the debts are gone the freed budget is invested, so FI arrives sooner than without debts.
    expect(r.fiK).not.toBeNull();
    expect(r.fiK!).toBeLessThan(ex.expected.fiMonths);
    expect(r.plan.retiredAtK).toBe(r.fiK);
    // Deterministic.
    expect(runPlan(input).fiK).toBe(r.fiK);
  });
});
