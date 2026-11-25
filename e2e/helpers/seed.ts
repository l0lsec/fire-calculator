// Seeds households directly through the repository layer (test code may mint scopes).

import { readFileSync } from "node:fs";
import {
  createDebt,
  createHouseholdForUser,
  createIncomeStream,
  createManualAccount,
  createPerson,
  createScenario,
  getBaselineScenario,
  type HouseholdScope,
  scopeFor,
  setSpendingProfile,
  updateScenario,
} from "@fire/db";
import { createClient } from "@fire/db/client";
import { ENV } from "./env";

export function db() {
  return createClient(ENV.DATABASE_URL as string, { max: 2 });
}

export function currentMonthIndex(now = new Date()): number {
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

export interface WorkedExample {
  inputs: {
    age: number;
    retirementAge: number;
    annualExpenses: number;
    essentialExpenses: number;
    partTimeIncome: number;
    fatMultiplier: number;
    swr: number;
    realReturn: number;
    portfolio: number;
    monthlyContribution: number;
    extraDebtPayment: number;
    debts: { name: string; balance: number; apr: number; minPayment: number }[];
  };
  expected: Record<string, number | { months: number; totalInterest: number }>;
}

export function workedExample(): WorkedExample {
  const plan = readFileSync(new URL("../../BUILD_PLAN.md", import.meta.url), "utf8");
  const m = plan.match(/```json worked-example\n([\s\S]*?)\n```/);
  if (!m?.[1]) throw new Error("worked example missing");
  return JSON.parse(m[1]) as WorkedExample;
}

/** The section 10 household, entered as a user would, with or without its debts. */
export async function seedWorkedExample(
  userId: string,
  opts: { withDebts?: boolean } = {},
): Promise<HouseholdScope> {
  const ex = workedExample().inputs;
  const { db: d, close } = db();
  try {
    const scope = scopeFor(await createHouseholdForUser(d, userId, "Worked example"));
    const person = await createPerson(d, scope, {
      name: "Alex",
      birthMonth: currentMonthIndex() - ex.age * 12,
    });
    await createManualAccount(d, scope, {
      name: "Brokerage",
      type: "manual",
      bucket: "taxable",
      currentCents: ex.portfolio * 100,
    });
    await createIncomeStream(d, scope, {
      personId: person.id,
      name: "Pay",
      kind: "takeHome",
      monthlyCents: Math.round((ex.annualExpenses / 12 + ex.monthlyContribution) * 100),
      growth: "none",
      phase: "working",
    });
    await setSpendingProfile(d, scope, {
      source: "manual",
      manualAnnualCents: ex.annualExpenses * 100,
      manualEssentialCents: ex.essentialExpenses * 100,
    });
    if (opts.withDebts) {
      for (const debt of ex.debts) {
        await createDebt(d, scope, {
          name: debt.name,
          kind: "other",
          balanceCents: debt.balance * 100,
          apr: debt.apr,
          minPaymentRule: { type: "fixed", amount: debt.minPayment },
        });
      }
    }
    const baseline =
      (await getBaselineScenario(d, scope)) ??
      (await createScenario(d, scope, { name: "My plan", isBaseline: true, assumptions: {}, debtPlan: {} }));
    await updateScenario(d, scope, baseline.id, {
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
      debtPlan: { strategy: "avalanche", extraMonthly: ex.extraDebtPayment },
      retirementAdjustments: [],
    });
    return scope;
  } finally {
    await close();
  }
}
