// The section 10 worked example is the single source of truth for golden
// tests: read straight from BUILD_PLAN.md so the plan and the engine cannot drift.
import { readFileSync } from "node:fs";

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
  expected: {
    leanFI: number;
    fi: number;
    fatFI: number;
    baristaFI: number;
    coastFIToday: number;
    coastFIMonths: number;
    fiMonths: number;
    avalanche: { months: number; totalInterest: number };
    snowball: { months: number; totalInterest: number };
  };
}

export function workedExample(): WorkedExample {
  const plan = readFileSync(new URL("../../../BUILD_PLAN.md", import.meta.url), "utf8");
  const m = plan.match(/```json worked-example\n([\s\S]*?)\n```/);
  if (!m?.[1]) throw new Error("worked-example block missing from BUILD_PLAN.md");
  return JSON.parse(m[1]) as WorkedExample;
}
