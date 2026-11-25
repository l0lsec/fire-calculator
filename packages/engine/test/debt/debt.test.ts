import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Debt, DebtPlan, monthIndex } from "../../src/core";
import {
  balancesAt,
  compareStrategies,
  effectiveApr,
  MAX_DEBT_MONTHS,
  monthWhenNoDebtAbove,
  simulateDebts,
} from "../../src/debt";
import { workedExample } from "../fixture";

const START = monthIndex(2026, 1);
const plan = (p: Partial<DebtPlan> = {}) => DebtPlan.parse(p);

function exampleDebts(): Debt[] {
  return workedExample().inputs.debts.map((d) => ({
    id: d.name.replace(/\s+/g, "-"),
    name: d.name,
    kind: "other",
    balance: d.balance,
    apr: d.apr,
    minPayment: { type: "fixed", amount: d.minPayment },
    escrowMonthly: 0,
  }));
}

describe("worked example golden", () => {
  const ex = workedExample();

  it("avalanche matches the plan fixture to the cent", () => {
    const r = simulateDebts(
      exampleDebts(),
      plan({ strategy: "avalanche", extraMonthly: ex.inputs.extraDebtPayment }),
      {
        startMonth: START,
      },
    );
    expect(r.months).toBe(ex.expected.avalanche.months);
    expect(Math.round(r.totalInterest * 100) / 100).toBe(ex.expected.avalanche.totalInterest);
    expect(r.payoffOrder).toEqual(["credit-card", "personal-loan", "car-loan", "student-loan"]);
    expect(r.payoffMonth).toEqual({
      "credit-card": 13,
      "personal-loan": 15,
      "car-loan": 26,
      "student-loan": 42,
    });
    expect(r.budget).toBe(1615);
  });

  it("snowball matches the plan fixture to the cent", () => {
    const r = simulateDebts(
      exampleDebts(),
      plan({ strategy: "snowball", extraMonthly: ex.inputs.extraDebtPayment }),
      {
        startMonth: START,
      },
    );
    expect(r.months).toBe(ex.expected.snowball.months);
    expect(Math.round(r.totalInterest * 100) / 100).toBe(ex.expected.snowball.totalInterest);
    expect(r.payoffOrder).toEqual(["personal-loan", "credit-card", "car-loan", "student-loan"]);
    expect(r.payoffMonth["personal-loan"]).toBe(6);
    expect(r.payoffMonth["credit-card"]).toBe(16);
  });

  it("strategy comparison reports interest saved against minimums", () => {
    const c = compareStrategies(exampleDebts(), plan({ extraMonthly: 500 }), { startMonth: START });
    expect(c.interestSaved.avalanche).toBeGreaterThan(c.interestSaved.snowball);
    expect(c.interestSaved.minimum).toBe(0);
    expect(c.results.minimum.months).toBeGreaterThan(c.results.avalanche.months);
  });
});

// Property generators: fixed or card-style minimums that always cover interest.
const arbDebt = (i: number) =>
  fc
    .record({
      balance: fc.double({ min: 100, max: 60000, noNaN: true }),
      apr: fc.double({ min: 0, max: 0.3, noNaN: true }),
      card: fc.boolean(),
      minPct: fc.double({ min: 0.01, max: 0.05, noNaN: true }),
    })
    .map(({ balance, apr, card, minPct }): Debt => {
      const interest = (balance * apr) / 12;
      return {
        id: `d${i}`,
        name: `Debt ${i}`,
        kind: card ? "credit_card" : "personal",
        balance,
        apr,
        minPayment: card
          ? { type: "card", floor: 25, pct: minPct }
          : { type: "fixed", amount: Math.ceil(interest + balance * minPct + 10) },
        escrowMonthly: 0,
      };
    });
const arbDebts = fc
  .integer({ min: 1, max: 5 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbDebt(i))));

describe("debt properties", () => {
  it("extra payment never delays payoff", () => {
    fc.assert(
      fc.property(
        arbDebts,
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (debts, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          for (const strategy of ["avalanche", "snowball"] as const) {
            const r1 = simulateDebts(debts, plan({ strategy, extraMonthly: lo }), { startMonth: START });
            const r2 = simulateDebts(debts, plan({ strategy, extraMonthly: hi }), { startMonth: START });
            expect(r2.months).toBeLessThanOrEqual(r1.months);
            expect(r2.totalInterest).toBeLessThanOrEqual(r1.totalInterest + 1e-6);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("avalanche interest is never above snowball's beyond rounding", () => {
    fc.assert(
      fc.property(arbDebts, fc.double({ min: 0, max: 2000, noNaN: true }), (debts, extra) => {
        const av = simulateDebts(debts, plan({ strategy: "avalanche", extraMonthly: extra }), {
          startMonth: START,
        });
        const sn = simulateDebts(debts, plan({ strategy: "snowball", extraMonthly: extra }), {
          startMonth: START,
        });
        expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest + 0.01);
      }),
      { numRuns: 300 },
    );
  });

  it("balances never go negative and payments never exceed what is owed", () => {
    fc.assert(
      fc.property(arbDebts, fc.double({ min: 0, max: 3000, noNaN: true }), (debts, extra) => {
        for (const strategy of ["avalanche", "snowball", "hybrid", "minimum", "custom"] as const) {
          const r = simulateDebts(debts, plan({ strategy, extraMonthly: extra }), { startMonth: START });
          let prev = Object.fromEntries(debts.map((d) => [d.id, d.balance]));
          for (const row of r.schedule) {
            for (const d of debts) {
              const bal = row.balances[d.id] ?? 0;
              expect(bal).toBeGreaterThanOrEqual(0);
              const owed = (prev[d.id] ?? 0) + (row.interest[d.id] ?? 0);
              expect(row.payments[d.id] ?? 0).toBeLessThanOrEqual(owed + 1e-9);
            }
            prev = row.balances;
          }
          expect(r.paidOff).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("negative amortization", () => {
  it("a minimum below interest warns and terminates", () => {
    const debt: Debt = {
      id: "trap",
      name: "Trap card",
      kind: "credit_card",
      balance: 10000,
      apr: 0.3,
      minPayment: { type: "fixed", amount: 100 },
      escrowMonthly: 0,
    };
    const r = simulateDebts([debt], plan({ strategy: "minimum" }), { startMonth: START });
    expect(r.warnings.map((w) => w.code)).toContain("negative-amortization");
    expect(r.warnings.map((w) => w.code)).toContain("debt-not-repaid");
    expect(r.paidOff).toBe(false);
    expect(r.months).toBe(MAX_DEBT_MONTHS);
    expect(r.payoffMonth.trap).toBeNull();
  });
});

describe("strategy rules", () => {
  const debts: Debt[] = [
    {
      id: "low",
      name: "Low rate",
      kind: "student",
      balance: 5000,
      apr: 0.04,
      minPayment: { type: "fixed", amount: 100 },
      escrowMonthly: 0,
    },
    {
      id: "high",
      name: "High rate",
      kind: "credit_card",
      balance: 5000,
      apr: 0.22,
      minPayment: { type: "fixed", amount: 150 },
      escrowMonthly: 0,
    },
  ];

  it("hybrid sends extra only to debts above the threshold", () => {
    const r = simulateDebts(debts, plan({ strategy: "hybrid", extraMonthly: 400, hybridThreshold: 0.07 }), {
      startMonth: START,
    });
    for (const row of r.schedule) expect(row.payments.low ?? 0).toBeLessThanOrEqual(100 + 1e-9);
    const highOff = r.payoffMonth.high ?? 0;
    // After the high-rate debt is gone, total payments drop below the budget.
    const after = r.schedule[highOff + 1];
    expect(after?.totalPayment).toBeLessThan(r.budget);
    expect(monthWhenNoDebtAbove(r, debts, 0.07)).toBe(highOff);
  });

  it("custom order is respected", () => {
    const r = simulateDebts(
      debts,
      plan({ strategy: "custom", extraMonthly: 400, customOrder: ["low", "high"] }),
      {
        startMonth: START,
      },
    );
    expect(r.payoffOrder).toEqual(["low", "high"]);
  });

  it("minimums only does not roll freed payments over", () => {
    const r = simulateDebts(debts, plan({ strategy: "minimum", extraMonthly: 400 }), { startMonth: START });
    for (const row of r.schedule) expect(row.totalPayment).toBeLessThanOrEqual(250 + 1e-9);
  });

  it("promo APR applies until its end month", () => {
    const promo: Debt = { ...debts[1]!, promo: { apr: 0, endsMonth: START + 6 } };
    expect(effectiveApr(promo, START + 5)).toBe(0);
    expect(effectiveApr(promo, START + 6)).toBe(0.22);
    const r = simulateDebts([promo], plan({ strategy: "minimum" }), { startMonth: START });
    expect(r.schedule[0]?.totalInterest).toBe(0);
    expect(r.schedule[6]?.totalInterest).toBeGreaterThan(0);
  });

  it("balancesAt returns start balances at k=0 and zeros after payoff", () => {
    const r = simulateDebts(debts, plan({ strategy: "avalanche", extraMonthly: 400 }), { startMonth: START });
    expect(balancesAt(r, 0)).toEqual({ low: 5000, high: 5000 });
    expect(balancesAt(r, r.months + 10)).toEqual({ low: 0, high: 0 });
  });
});
