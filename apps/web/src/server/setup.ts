// The first-run setup: four steps derived from what the household already has,
// so nothing new is stored. Done steps stay done; the flow resumes at the
// first unfinished one.
import type { HouseholdData } from "./snapshot";

export type SetupStepId = "people" | "spending" | "income" | "savings";

export interface SetupStep {
  id: SetupStepId;
  n: number;
  title: string;
  /** Why this step matters, in one line. */
  why: string;
  done: boolean;
}

export function setupSteps(
  data: Pick<HouseholdData, "people" | "income" | "accounts" | "spendingProfile" | "derivedSpending"> &
    Partial<Pick<HouseholdData, "incomeSource">>,
): SetupStep[] {
  const measured = (data.derivedSpending?.livingCents ?? 0) > 0;
  const estimated = (data.spendingProfile?.manualAnnualCents ?? 0) > 0;
  return [
    {
      id: "people",
      n: 1,
      title: "Add yourself",
      why: "Your birth month sets the timeline for every FI milestone.",
      done: data.people.length > 0,
    },
    {
      id: "spending",
      n: 2,
      title: "Connect a bank or enter what you spend",
      why: "Spending sets your FI number: about 25 times what you spend in a year.",
      done: measured || estimated,
    },
    {
      id: "income",
      n: 3,
      title: "Add your take-home pay",
      why: "What you earn minus what you spend is what you save toward FI.",
      // Measured take-home pay from connected accounts counts once there is someone to own it.
      done: data.income.length > 0 || (data.incomeSource === "measured" && data.people.length > 0),
    },
    {
      id: "savings",
      n: 4,
      title: "Add your savings and investments",
      why: "What you already have is your head start.",
      done: data.accounts.some((a) => a.includeInFi && a.bucket !== "excluded" && a.currentCents > 0),
    },
  ];
}

/** The step to show: the one asked for, else the first unfinished one, else null (all done). */
export function currentStep(steps: SetupStep[], asked?: string): SetupStep | null {
  const pick = steps.find((s) => s.id === asked);
  if (pick) return pick;
  return steps.find((s) => !s.done) ?? null;
}
