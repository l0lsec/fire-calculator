import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ageAt,
  annualRate,
  annuityPV,
  deflator,
  monthAtAge,
  monthIndex,
  monthLabel,
  monthlyRate,
  nominalRate,
  parseEngineInput,
  parseMonthLabel,
  realRate,
  toNominal,
  toReal,
  yearMonth,
} from "../../src/core";

const annual = fc.double({ min: -0.5, max: 0.5, noNaN: true });

describe("rates", () => {
  it("nominal to real and back round-trips", () => {
    fc.assert(
      fc.property(annual, fc.double({ min: -0.05, max: 0.2, noNaN: true }), (n, i) => {
        expect(Math.abs(nominalRate(realRate(n, i), i) - n)).toBeLessThan(1e-9);
      }),
    );
  });

  it("monthly and annual rates round-trip", () => {
    fc.assert(
      fc.property(annual, (a) => {
        expect(Math.abs(annualRate(monthlyRate(a)) - a)).toBeLessThan(1e-9);
      }),
    );
  });

  it("toReal and toNominal are inverses", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e9, noNaN: true }),
        fc.double({ min: -0.02, max: 0.15, noNaN: true }),
        fc.integer({ min: 0, max: 1200 }),
        (x, i, m) => {
          const back = toNominal(toReal(x, i, m), i, m);
          expect(Math.abs(back - x)).toBeLessThanOrEqual(1e-9 * Math.max(1, x));
        },
      ),
    );
  });

  it("deflator compounds annually per 12 months", () => {
    expect(deflator(0.03, 12)).toBeCloseTo(1.03, 12);
    expect(deflator(0.03, 0)).toBe(1);
  });

  it("annuityPV matches a direct sum and handles zero rate", () => {
    const direct = Array.from({ length: 24 }, (_, k) => 100 / 1.01 ** (k + 1)).reduce((a, b) => a + b, 0);
    expect(annuityPV(100, 0.01, 24)).toBeCloseTo(direct, 9);
    expect(annuityPV(100, 0, 24)).toBe(2400);
    expect(annuityPV(100, 0.01, 0)).toBe(0);
  });
});

describe("time", () => {
  it("month index and label round-trip", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1, max: 12 }), (y, m) => {
        const idx = monthIndex(y, m);
        expect(yearMonth(idx)).toEqual({ year: y, month: m });
        expect(parseMonthLabel(monthLabel(idx))).toBe(idx);
      }),
    );
  });

  it("ages and month-at-age agree", () => {
    const p = { id: "a", name: "A", birthMonth: monthIndex(1994, 6) };
    expect(ageAt(p, monthIndex(2026, 6))).toBe(32);
    expect(monthAtAge(p, 59.5)).toBe(monthIndex(1994, 6) + 714);
    expect(ageAt(p, monthAtAge(p, 65))).toBe(65);
  });

  it("rejects invalid months", () => {
    expect(() => monthIndex(2026, 13)).toThrow();
    expect(() => parseMonthLabel("2026-1")).toThrow();
  });
});

describe("schema", () => {
  const base = {
    startMonth: monthIndex(2026, 1),
    people: [{ id: "p1", name: "Alex", birthMonth: monthIndex(1994, 1) }],
    spending: { currentAnnual: 60000, currentEssentialAnnual: 40000 },
  };

  it("fills defaults", () => {
    const input = parseEngineInput(base);
    expect(input.assumptions.swr).toBe(0.04);
    expect(input.debtPlan.strategy).toBe("avalanche");
    expect(input.policy).toBe("payoffAtFI");
  });

  it("rejects essential above total, bad allocation and unknown person", () => {
    expect(() =>
      parseEngineInput({ ...base, spending: { currentAnnual: 1, currentEssentialAnnual: 2 } }),
    ).toThrow();
    expect(() =>
      parseEngineInput({
        ...base,
        assumptions: { allocation: { taxable: 0.5, traditional: 0, roth: 0, hsa: 0, cash: 0 } },
      }),
    ).toThrow();
    expect(() =>
      parseEngineInput({
        ...base,
        income: [
          { id: "i", name: "Pay", kind: "takeHome", personId: "nobody", monthly: 1, phase: "working" },
        ],
      }),
    ).toThrow();
  });

  it("rejects APR above 100% and negative balances", () => {
    const debt = {
      id: "d",
      name: "Card",
      kind: "credit_card",
      minPayment: { type: "fixed", amount: 10 },
    } as const;
    expect(() => parseEngineInput({ ...base, debts: [{ ...debt, balance: 100, apr: 1.5 }] })).toThrow();
    expect(() => parseEngineInput({ ...base, debts: [{ ...debt, balance: -1, apr: 0.2 }] })).toThrow();
  });
});
