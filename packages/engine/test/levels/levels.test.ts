import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EngineInputDraft, monthIndex, monthlyRate, parseEngineInput, realRate } from "../../src/core";
import { buildLadder, fiMonth, runPlan, targetsAt } from "../../src/levels";
import { project, real } from "../../src/projection";
import { workedExample } from "../fixture";

const START = monthIndex(2026, 1);

function exampleDraft(over: Partial<EngineInputDraft> = {}): EngineInputDraft {
  const ex = workedExample().inputs;
  return {
    startMonth: START,
    people: [{ id: "p1", name: "Alex", birthMonth: START - ex.age * 12 }],
    accounts: [{ id: "brk", name: "Brokerage", bucket: "taxable", balance: ex.portfolio }],
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
      fatMultiplier: ex.fatMultiplier,
      partTime: { annualNet: ex.partTimeIncome },
    },
    ...over,
  };
}

describe("worked example golden", () => {
  it("Lean FI, FI, Fat FI, Barista FI and Coast FI match the plan fixture, with the Coast FI and FI months", () => {
    const ex = workedExample().expected;
    const result = runPlan(parseEngineInput(exampleDraft()));
    expect(Math.round(result.levels.lean)).toBe(ex.leanFI);
    expect(Math.round(result.levels.fi)).toBe(ex.fi);
    expect(Math.round(result.levels.fat)).toBe(ex.fatFI);
    expect(Math.round(result.levels.barista)).toBe(ex.baristaFI);
    expect(Math.round(result.levels.coast)).toBe(ex.coastFIToday);
    const byId = Object.fromEntries(result.ladder.map((l) => [l.id, l]));
    expect(byId.coast?.reachedK).toBe(ex.coastFIMonths);
    expect(byId.fi?.reachedK).toBe(ex.fiMonths);
    expect(result.fiK).toBe(ex.fiMonths);
    expect(byId.coast?.reachedAge).toBeCloseTo(32 + 158 / 12, 9);
  });

  it("the ladder lists every milestone in order", () => {
    const result = runPlan(parseEngineInput(exampleDraft()));
    expect(result.ladder.map((l) => l.id)).toEqual([
      "emergency",
      "highInterestDebtFree",
      "consumerDebtFree",
      "coast",
      "halfFI",
      "lean",
      "barista",
      "fi",
      "fat",
      "debtFree",
    ]);
    const dates = result.ladder.filter((l) => ["coast", "halfFI", "lean", "fi", "fat"].includes(l.id));
    // Larger targets are never reached earlier.
    const k = (id: string) => dates.find((d) => d.id === id)?.reachedK ?? Number.POSITIVE_INFINITY;
    expect(k("halfFI")).toBeLessThanOrEqual(k("lean"));
    expect(k("lean")).toBeLessThanOrEqual(k("fi"));
    expect(k("fi")).toBeLessThanOrEqual(k("fat"));
  });
});

describe("coast cross-check", () => {
  it("the simulated Coast FI date equals the closed form within one month", () => {
    let dated = 0;
    let runs = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 25, max: 50 }),
        fc.double({ min: 0.03, max: 0.1, noNaN: true }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.double({ min: 0, max: 300_000, noNaN: true }),
        fc.double({ min: 200, max: 5000, noNaN: true }),
        fc.double({ min: 20_000, max: 120_000, noNaN: true }),
        (age, nominal, inflation, p0, contrib, spend) => {
          const input = parseEngineInput(
            exampleDraft({
              people: [{ id: "p1", name: "A", birthMonth: START - age * 12 }],
              accounts: [{ id: "brk", name: "B", bucket: "taxable", balance: p0 }],
              income: [
                {
                  id: "pay",
                  name: "Pay",
                  kind: "takeHome",
                  personId: "p1",
                  monthly: spend / 12 + contrib,
                  growth: "inflation",
                  phase: "working",
                },
              ],
              spending: { currentAnnual: spend, currentEssentialAnnual: spend / 2 },
              assumptions: {
                ...exampleDraft().assumptions,
                nominalReturn: nominal,
                inflation,
                retirementAge: 65,
                partTime: undefined,
              },
            }),
          );
          const acc = project(input, { neverRetire: true });
          const simulated = buildLadder(input, acc).find((l) => l.id === "coast")?.reachedK ?? null;

          // Closed form in real terms: P0 + c (1 - a^-t) / m >= C0, with a = 1 + m.
          const r = realRate(nominal, inflation);
          const m = monthlyRate(r);
          // Contributions are paid at month end in month-end prices: c real per month.
          const fi = spend / input.assumptions.swr;
          const c0 = fi / (1 + r) ** (65 - age);
          let closed: number | null;
          if (p0 >= c0) closed = 0;
          else {
            const x = 1 - ((c0 - p0) * m) / contrib;
            closed = x <= 0 ? null : Math.ceil(-Math.log(x) / Math.log(1 + m) - 1e-9);
            if (closed !== null && closed > (65 - age) * 12) closed = null;
          }
          if (closed === null) {
            // Unreachable before the retirement age: the simulation must agree it is not reached before then.
            if (simulated !== null) expect(simulated).toBeGreaterThanOrEqual((65 - age) * 12 - 1);
          } else {
            expect(simulated).not.toBeNull();
            expect(Math.abs((simulated ?? 0) - closed)).toBeLessThanOrEqual(1);
            if (closed > 0) dated++;
          }
          runs++;
        },
      ),
      { numRuns: 200 },
    );
    // Guard against a vacuous pass: most runs must compare a real future date.
    // Observed share is about 0.3 over 200 runs (sd about 0.03); 0.15 is a robust floor.
    expect(dated / runs).toBeGreaterThan(0.15);
  });
});

describe("debt at FI", () => {
  const debtArb = fc.record({
    balance: fc.double({ min: 1000, max: 80000, noNaN: true }),
    apr: fc.double({ min: 0.02, max: 0.25, noNaN: true }),
    payPct: fc.double({ min: 0.015, max: 0.05, noNaN: true }),
  });

  it("adding a debt raises the FI target by exactly its balance and never moves the FI date earlier", () => {
    fc.assert(
      fc.property(
        debtArb,
        fc.double({ min: 0, max: 0.04, noNaN: true }),
        ({ balance, apr, payPct }, inflation) => {
          const base = exampleDraft({
            assumptions: { ...exampleDraft().assumptions, inflation, partTime: undefined },
          });
          const withDebt = {
            ...base,
            debts: [
              {
                id: "d",
                name: "Loan",
                kind: "personal" as const,
                balance,
                apr,
                minPayment: {
                  type: "fixed" as const,
                  amount: Math.ceil((balance * apr) / 12 + balance * payPct),
                },
              },
            ],
          };
          const a = parseEngineInput(base);
          const b = parseEngineInput(withDebt);
          const accA = project(a, { neverRetire: true });
          const accB = project(b, { neverRetire: true });
          for (let k = 0; k < accB.rows.length; k += 23) {
            const rowA = accA.rows[k]!;
            const rowB = accB.rows[k]!;
            const diff = targetsAt(b, accB, rowB).fi - targetsAt(a, accA, rowA).fi;
            expect(Math.abs(diff - real(rowB, rowB.debtBalance))).toBeLessThan(1e-6);
          }
          const fa = fiMonth(a, accA);
          const fb = fiMonth(b, accB);
          if (fa === null) expect(fb).toBeNull();
          else if (fb !== null) expect(fb).toBeGreaterThanOrEqual(fa);
        },
      ),
      { numRuns: 80 },
    );
  });

  it("keep mortgage counts less than the balance when returns beat the rate, and debt-free-first waits for consumer debt", () => {
    const debts = [
      {
        id: "m",
        name: "Mortgage",
        kind: "mortgage" as const,
        balance: 300000,
        apr: 0.03,
        minPayment: { type: "fixed" as const, amount: 1800 },
      },
      {
        id: "c",
        name: "Card",
        kind: "credit_card" as const,
        balance: 15000,
        apr: 0.24,
        minPayment: { type: "fixed" as const, amount: 300 },
      },
    ];
    const pay = parseEngineInput(
      exampleDraft({
        debts,
        policy: "payoffAtFI",
        assumptions: { ...exampleDraft().assumptions, nominalReturn: 0.07 },
      }),
    );
    const keep = parseEngineInput(
      exampleDraft({
        debts,
        policy: "keepMortgage",
        assumptions: { ...exampleDraft().assumptions, nominalReturn: 0.07 },
      }),
    );
    const accP = project(pay, { neverRetire: true });
    const accK = project(keep, { neverRetire: true });
    const dP = targetsAt(pay, accP, accP.rows[0]!).debt;
    const dK = targetsAt(keep, accK, accK.rows[0]!).debt;
    expect(dP).toBe(315000);
    expect(dK).toBeLessThan(dP);
    expect(dK).toBeGreaterThan(15000);

    const first = parseEngineInput(
      exampleDraft({
        debts,
        policy: "debtFreeFirst",
        accounts: [{ id: "brk", name: "B", bucket: "taxable", balance: 5_000_000 }],
      }),
    );
    const accF = project(first, { neverRetire: true });
    const k = fiMonth(first, accF);
    // Rich enough on day one, but not FI until the card is gone.
    expect(k).toBe(accF.debt.payoffMonth.c);
  });
});

describe("barista", () => {
  it("bridged Barista FI with part-time income equal to expenses equals Coast FI", () => {
    const input = parseEngineInput(
      exampleDraft({
        assumptions: {
          ...exampleDraft().assumptions,
          nominalReturn: 0.07,
          inflation: 0.025,
          partTime: { annualNet: 60000, healthAnnual: 0, untilAge: 60 },
        },
      }),
    );
    const acc = project(input, { neverRetire: true });
    for (const k of [0, 1, 50, 200]) {
      const t = targetsAt(input, acc, acc.rows[k]!);
      expect(Math.abs(t.barista - t.coast)).toBeLessThan(1);
    }
  });

  it("perpetual Barista FI subtracts part-time income and adds uncovered health cost", () => {
    const input = parseEngineInput(
      exampleDraft({
        assumptions: { ...exampleDraft().assumptions, partTime: { annualNet: 24000, healthAnnual: 6000 } },
      }),
    );
    expect(runPlan(input).levels.barista).toBeCloseTo((60000 + 6000 - 24000) / 0.04, 6);
  });
});

describe("taxes and guaranteed income", () => {
  it("withdrawal tax grosses up the spending part only", () => {
    const input = parseEngineInput(
      exampleDraft({
        assumptions: { ...exampleDraft().assumptions, withdrawalTaxRate: 0.2 },
        debts: [
          {
            id: "c",
            name: "Card",
            kind: "credit_card",
            balance: 1000,
            apr: 0.2,
            minPayment: { type: "fixed", amount: 100 },
          },
        ],
      }),
    );
    expect(runPlan(input).levels.fi).toBeCloseTo(60000 / 0.04 / 0.8 + 1000, 6);
  });

  it("guaranteed income lowers the target only from its start age", () => {
    const input = parseEngineInput(
      exampleDraft({
        people: [{ id: "p1", name: "Alex", birthMonth: START - 66 * 12 }],
        income: [
          {
            id: "ss",
            name: "Social Security",
            kind: "socialSecurity",
            personId: "p1",
            monthly: 2000,
            phase: "retired",
            startAge: 67,
          },
        ],
        assumptions: { ...exampleDraft().assumptions, countGuaranteedIncome: true, partTime: undefined },
      }),
    );
    const acc = project(input, { neverRetire: true });
    expect(targetsAt(input, acc, acc.rows[0]!).fi).toBeCloseTo(60000 / 0.04, 6);
    expect(targetsAt(input, acc, acc.rows[12]!).fi).toBeCloseTo(36000 / 0.04, 6);
  });
});

describe("plan path", () => {
  it("retire-at-FI retires at the FI month and warns when FI is traditional-heavy before 59.5", () => {
    const input = parseEngineInput(
      exampleDraft({
        accounts: [{ id: "k", name: "401k", bucket: "traditional", balance: 900_000 }],
        assumptions: {
          ...exampleDraft().assumptions,
          allocation: { taxable: 0, traditional: 1, roth: 0, hsa: 0, cash: 0 },
        },
      }),
    );
    const r = runPlan(input);
    expect(r.fiK).not.toBeNull();
    expect(r.plan.retiredAtK).toBe(r.fiK);
    expect(r.warnings.map((w) => w.code)).toContain("fi-before-59-5-traditional-heavy");
  });
});
