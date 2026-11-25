import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EngineInputDraft, monthIndex, parseEngineInput, realRate } from "../../src/core";
import { fiPortfolio, firstMonthReaching, project, real } from "../../src/projection";
import { workedExample } from "../fixture";

const START = monthIndex(2026, 1);

function exampleInput(over: Partial<EngineInputDraft> = {}): EngineInputDraft {
  const ex = workedExample().inputs;
  return {
    startMonth: START,
    people: [{ id: "p1", name: "Alex", birthMonth: START - ex.age * 12 }],
    accounts: [{ id: "brk", name: "Brokerage", bucket: "taxable", balance: ex.portfolio }],
    // Surplus of exactly the monthly contribution: income minus spending.
    income: [
      {
        id: "pay",
        name: "Pay",
        kind: "takeHome",
        personId: "p1",
        monthly: ex.annualExpenses / 12 + ex.monthlyContribution,
        growth: "none",
        phase: "working",
      },
    ],
    spending: { currentAnnual: ex.annualExpenses, currentEssentialAnnual: ex.essentialExpenses },
    assumptions: {
      nominalReturn: ex.realReturn,
      inflation: 0,
      raiseRate: 0,
      swr: ex.swr,
      retirementAge: ex.retirementAge,
      emergencyMonths: 0,
      withdrawalTaxRate: 0,
    },
    ...over,
  };
}

describe("real and nominal", () => {
  it("with zero inflation the real and nominal series are identical", () => {
    const p = project(parseEngineInput(exampleInput()), { neverRetire: true, horizonMonths: 600 });
    for (const row of p.rows) {
      expect(row.deflator).toBe(1);
      expect(real(row, fiPortfolio(row))).toBe(fiPortfolio(row));
    }
  });

  it("a nominal run deflated equals the same plan run in real terms", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 0.12, noNaN: true }),
        fc.double({ min: 0.0, max: 0.08, noNaN: true }),
        fc.double({ min: 0.0, max: 0.06, noNaN: true }),
        fc.double({ min: 0, max: 2_000_000, noNaN: true }),
        fc.double({ min: 0, max: 6000, noNaN: true }),
        fc.integer({ min: 0, max: 12 }),
        (nominal, inflation, raise, start, surplus, emergency) => {
          const base = exampleInput({
            accounts: [
              { id: "brk", name: "Brokerage", bucket: "taxable", balance: start },
              { id: "cash", name: "Checking", bucket: "cash", balance: start / 10 },
            ],
            income: [
              {
                id: "pay",
                name: "Pay",
                kind: "takeHome",
                personId: "p1",
                monthly: 5000 + surplus,
                growth: "raise",
                phase: "working",
              },
            ],
            contributions: [{ id: "k", name: "401k", bucket: "traditional", monthly: 800 }],
          });
          const nominalRun = project(
            parseEngineInput({
              ...base,
              assumptions: {
                ...base.assumptions,
                nominalReturn: nominal,
                inflation,
                raiseRate: raise,
                cashReturn: 0.02,
                emergencyMonths: emergency,
              },
            }),
            { neverRetire: true, horizonMonths: 600 },
          );
          const realRun = project(
            parseEngineInput({
              ...base,
              assumptions: {
                ...base.assumptions,
                nominalReturn: realRate(nominal, inflation),
                inflation: 0,
                raiseRate: realRate(raise, inflation),
                cashReturn: realRate(0.02, inflation),
                emergencyMonths: emergency,
              },
            }),
            { neverRetire: true, horizonMonths: 600 },
          );
          for (let k = 0; k <= 600; k += 37) {
            const a = real(nominalRun.rows[k]!, fiPortfolio(nominalRun.rows[k]!));
            const b = fiPortfolio(realRun.rows[k]!);
            // Within a cent per $1M.
            expect(Math.abs(a - b)).toBeLessThanOrEqual(0.01 * Math.max(1, Math.abs(b) / 1e6));
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("worked example", () => {
  it("reproduces the plan's full FI month with no debts", () => {
    const ex = workedExample();
    const p = project(parseEngineInput(exampleInput()), { neverRetire: true });
    const target = ex.inputs.annualExpenses / ex.inputs.swr;
    expect(firstMonthReaching(p.rows, () => target)).toBe(ex.expected.fiMonths);
  });
});

describe("retirement and debt policy", () => {
  const withDebts = (policy: "payoffAtFI" | "keepMortgage") =>
    parseEngineInput(
      exampleInput({
        policy,
        accounts: [{ id: "brk", name: "Brokerage", bucket: "taxable", balance: 1_000_000 }],
        debts: [
          {
            id: "car",
            name: "Car",
            kind: "auto",
            balance: 10000,
            apr: 0.07,
            minPayment: { type: "fixed", amount: 300 },
          },
          {
            id: "mtg",
            name: "Mortgage",
            kind: "mortgage",
            balance: 200000,
            apr: 0.04,
            minPayment: { type: "fixed", amount: 1200 },
            escrowMonthly: 300,
          },
        ],
      }),
    );

  it("payoff at FI retires every balance from the portfolio at the transition", () => {
    const p = project(withDebts("payoffAtFI"), { retireAtK: 12, horizonMonths: 24 });
    const before = p.rows[12]!;
    const after = p.rows[13]!;
    expect(before.debtBalance).toBeGreaterThan(0);
    expect(after.debtBalance).toBe(0);
    expect(after.debtPayment).toBe(0);
    expect(p.depletedAtK).toBeNull();
    // The lump sum came out of the portfolio: growth, minus the payoff, minus a month of spending.
    const grown = fiPortfolio(before) * 1.05 ** (1 / 12);
    expect(fiPortfolio(after)).toBeCloseTo(grown - before.debtBalance - after.withdrawals, 4);
  });

  it("keep mortgage pays the car off and keeps paying the mortgage minimum", () => {
    const p = project(withDebts("keepMortgage"), { retireAtK: 12 });
    const after = p.rows[13]!;
    expect(after.debtPayment).toBeCloseTo(1200, 6);
    expect(after.mortgageBalance).toBeGreaterThan(0);
    expect(after.debtBalance).toBe(after.mortgageBalance);
    // Escrow is still a living expense after retirement.
    expect(after.livingExpenses).toBeCloseTo(60000 / 12 + 300, 6);
  });

  it("an underfunded retirement depletes and warns", () => {
    const input = parseEngineInput(
      exampleInput({ accounts: [{ id: "b", name: "B", bucket: "taxable", balance: 50000 }] }),
    );
    const p = project(input, { retireAtK: 0 });
    expect(p.depletedAtK).not.toBeNull();
    expect(p.warnings.map((w) => w.code)).toContain("portfolio-depleted");
    for (const row of p.rows) for (const v of Object.values(row.buckets)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("a working deficit draws savings down and warns once", () => {
    const input = parseEngineInput(
      exampleInput({
        income: [
          {
            id: "pay",
            name: "Pay",
            kind: "takeHome",
            personId: "p1",
            monthly: 4000,
            growth: "none",
            phase: "working",
          },
        ],
      }),
    );
    const p = project(input, { neverRetire: true, horizonMonths: 24 });
    expect(p.warnings.filter((w) => w.code === "deficit")).toHaveLength(1);
    expect(fiPortfolio(p.rows[24]!)).toBeLessThan(150000 * 1.05 ** 2);
  });

  it("the emergency reserve fills before investing", () => {
    const input = parseEngineInput(
      exampleInput({ accounts: [], assumptions: { ...exampleInput().assumptions, emergencyMonths: 6 } }),
    );
    const p = project(input, { neverRetire: true, horizonMonths: 12 });
    // Essentials are 40000/yr, so the reserve is 20000; 2000/mo fills it in 10 months.
    expect(p.rows[9]!.buckets.taxable).toBe(0);
    expect(p.rows[10]!.buckets.cash).toBeCloseTo(20000, 6);
    expect(p.rows[12]!.buckets.taxable).toBeGreaterThan(0);
  });
});

describe("performance", () => {
  it("a 600-month projection runs in under 50 ms", () => {
    const input = parseEngineInput(exampleInput());
    project(input, { neverRetire: true, horizonMonths: 600 });
    const t0 = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) project(input, { retireAtK: 300, horizonMonths: 600 });
    const per = (performance.now() - t0) / runs;
    expect(per).toBeLessThan(50);
  });
});

describe("return paths", () => {
  it("with a return path, inflation-linked spending follows the path's realized prices, not the assumption", () => {
    const input = parseEngineInput(
      exampleInput({ assumptions: { ...exampleInput().assumptions, inflation: 0.03 } }),
    );
    const m = 1.1 ** (1 / 12) - 1; // 10% a year actual inflation
    const path = {
      invested: Array.from({ length: 24 }, () => 0),
      inflation: Array.from({ length: 24 }, () => m),
    };
    const p = project(input, { path, neverRetire: true, horizonMonths: 24 });
    expect(p.rows[12]!.deflator).toBeCloseTo(1.1, 9);
    expect(p.rows[12]!.livingExpenses).toBeCloseTo((60000 / 12) * 1.1, 6);
    // Without a path the assumption applies.
    const q = project(input, { neverRetire: true, horizonMonths: 24 });
    expect(q.rows[12]!.livingExpenses).toBeCloseTo((60000 / 12) * 1.03, 6);
  });
});
