// Household data -> EngineInput (BUILD_PLAN section 3 data flow). Problems
// that would make the plan silently wrong (no people, no spending, a debt with
// no interest rate) are returned as issues instead of guessed.
import {
  type Db,
  getSpendingProfile,
  type HouseholdScope,
  listAccounts,
  listCategoryRules,
  listContributionStreams,
  listDebts,
  listIncomeStreams,
  listItems,
  listOverrides,
  listPeople,
  listTransactions,
} from "@fire/db";
import {
  type Debt,
  type EngineInput,
  type EngineInputDraft,
  MinPaymentRule,
  monthIndex,
  parseEngineInput,
} from "@fire/engine/core";
import { type PlanResult, runPlan } from "@fire/engine/levels";
import { type AnnualSpending, deriveSpending, spendingWindow } from "@fire/spending";
import { ZodError } from "zod";
import { loadScenario, readScenario, type Scenario, type ScenarioRow } from "../scenarios";
import { todayISO } from "../today";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export type IssueCode = "no-people" | "no-spending" | "unknown-apr" | "invalid";
export interface SnapshotIssue {
  code: IssueCode;
  message: string;
  ref?: string;
}

export interface HouseholdData {
  people: Awaited<ReturnType<typeof listPeople>>;
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  debts: Awaited<ReturnType<typeof listDebts>>;
  income: Awaited<ReturnType<typeof listIncomeStreams>>;
  contributions: Awaited<ReturnType<typeof listContributionStreams>>;
  spendingProfile: Awaited<ReturnType<typeof getSpendingProfile>>;
  derivedSpending: AnnualSpending | null;
  /** The spending figure the plan actually uses (see effectiveSpendingSource). */
  spendingSource: "manual" | "plaid";
}

type Profile = HouseholdData["spendingProfile"];

/** True unless the user chose their own estimate and entered one, so measured spending is worth deriving. */
const wantsMeasured = (p: Profile) => p?.source === "plaid" || (p?.manualAnnualCents ?? 0) <= 0;

/** Any account from a bank link or the iPhone companion, i.e. one whose transactions can measure spending. */
export const hasConnectedAccounts = (data: Pick<HouseholdData, "accounts">) =>
  data.accounts.some((a) => a.source !== "manual");

/**
 * Measured spending from connected accounts is the default: it is used whenever there is any,
 * unless the user explicitly chose their own estimate and entered a figure.
 */
export function effectiveSpendingSource(p: Profile, derived: AnnualSpending | null): "manual" | "plaid" {
  if (!derived || derived.livingCents <= 0) return "manual";
  return wantsMeasured(p) ? "plaid" : "manual";
}

export { todayISO } from "../today";

export async function deriveHouseholdSpending(ctx: Ctx, asOf: string, debts?: HouseholdData["debts"]) {
  const win = spendingWindow(asOf);
  const [accounts, transactions, overrides, rules, debtRows, items] = await Promise.all([
    listAccounts(ctx.db, ctx.scope, { includeArchived: true }),
    listTransactions(ctx.db, ctx.scope, win.start, win.end),
    listOverrides(ctx.db, ctx.scope),
    listCategoryRules(ctx.db, ctx.scope),
    debts ? Promise.resolve(debts) : listDebts(ctx.db, ctx.scope),
    listItems(ctx.db, ctx.scope),
  ]);
  const institution = new Map(items.map((i) => [i.id, i.institutionName]));
  return deriveSpending({
    asOf,
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      subtype: a.subtype,
      name: a.name,
      mask: a.mask,
      institution: a.itemId ? (institution.get(a.itemId) ?? null) : null,
      business: a.business,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      date: t.postedDate,
      amountCents: t.amountCents,
      name: t.name,
      merchant: t.merchant,
      pfcPrimary: t.pfcPrimary,
      pfcDetailed: t.pfcDetailed,
      pending: t.pending,
    })),
    overrides: overrides.map((o) => ({
      transactionId: o.transactionId,
      class: o.class,
      essential: o.essential,
      oneTime: o.oneTime,
      amortizeYears: o.amortizeYears,
    })),
    rules: rules.map((r) => ({ pfcDetailed: r.pfcDetailed, class: r.class, essential: r.essential })),
    mortgages: debtRows
      .filter((d) => d.kind === "mortgage" && d.escrowMonthlyCents > 0)
      .map((d) => ({ debtId: d.id, escrowMonthlyCents: d.escrowMonthlyCents })),
  });
}

export async function loadHousehold(ctx: Ctx, asOf: string): Promise<HouseholdData> {
  const [people, accounts, debts, income, contributions, spendingProfile] = await Promise.all([
    listPeople(ctx.db, ctx.scope),
    listAccounts(ctx.db, ctx.scope),
    listDebts(ctx.db, ctx.scope),
    listIncomeStreams(ctx.db, ctx.scope),
    listContributionStreams(ctx.db, ctx.scope),
    getSpendingProfile(ctx.db, ctx.scope),
  ]);
  const derivedSpending = wantsMeasured(spendingProfile)
    ? await deriveHouseholdSpending(ctx, asOf, debts)
    : null;
  return {
    people,
    accounts,
    debts,
    income,
    contributions,
    spendingProfile,
    derivedSpending,
    spendingSource: effectiveSpendingSource(spendingProfile, derivedSpending),
  };
}

/** Annual living spending (excluding escrow, which comes from mortgages) and its essential share, in dollars. */
export function spendingBasis(
  data: HouseholdData,
  scenario: Scenario,
): { annual: number; essential: number; source: "manual" | "plaid" } {
  let annual: number;
  let essential: number;
  const source = data.spendingSource;
  if (source === "plaid" && data.derivedSpending) {
    annual = data.derivedSpending.livingCents / 100;
    essential = data.derivedSpending.livingEssentialCents / 100;
  } else {
    annual = (data.spendingProfile?.manualAnnualCents ?? 0) / 100;
    essential = (data.spendingProfile?.manualEssentialCents ?? 0) / 100;
  }
  if (scenario.spendingOverrideCents !== null && scenario.spendingOverrideCents !== undefined) {
    const ratio = annual > 0 ? essential / annual : 0.6;
    annual = scenario.spendingOverrideCents / 100;
    essential = annual * ratio;
  }
  return { annual: Math.max(0, annual), essential: Math.max(0, Math.min(essential, annual)), source };
}

/** Debt rows -> engine debts. A debt with no known rate is an issue, never a 0% loan. */
export function toEngineDebts(rows: HouseholdData["debts"]): { debts: Debt[]; issues: SnapshotIssue[] } {
  const issues: SnapshotIssue[] = [];
  const debts: Debt[] = [];
  for (const d of rows) {
    if (d.balanceCents <= 0) continue;
    if (d.apr === null) {
      issues.push({ code: "unknown-apr", message: `Add the interest rate for ${d.name}.`, ref: d.id });
      continue;
    }
    const rule = MinPaymentRule.safeParse(d.minPaymentRule);
    debts.push({
      id: d.id,
      name: d.name,
      kind: d.kind,
      balance: d.balanceCents / 100,
      apr: d.apr,
      minPayment: rule.success ? rule.data : { type: "fixed", amount: 0 },
      ...(d.promoApr !== null && d.promoEndsMonth !== null
        ? { promo: { apr: d.promoApr, endsMonth: d.promoEndsMonth } }
        : {}),
      escrowMonthly: d.escrowMonthlyCents / 100,
    });
  }

  return { debts, issues };
}

export function buildEngineInput(
  data: HouseholdData,
  scenario: Scenario,
  asOf: string,
): { input: EngineInput | null; issues: SnapshotIssue[] } {
  const issues: SnapshotIssue[] = [];
  if (data.people.length === 0) {
    issues.push({ code: "no-people", message: "Add your birth month so the plan knows your age." });
  }
  const spend = spendingBasis(data, scenario);
  if (spend.annual <= 0) {
    issues.push({
      code: "no-spending",
      message: hasConnectedAccounts(data)
        ? "Your connected accounts show no spending in the last 12 months yet. Enter an estimate for now."
        : "Enter your annual spending, or connect accounts to measure it.",
    });
  }

  const { debts, issues: debtIssues } = toEngineDebts(data.debts);
  issues.push(...debtIssues);

  if (issues.some((i) => i.code === "no-people" || i.code === "no-spending")) return { input: null, issues };

  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const draft: EngineInputDraft = {
    startMonth: monthIndex(y, m),
    people: data.people.map((p) => ({ id: p.id, name: p.name, birthMonth: p.birthMonth })),
    accounts: data.accounts
      .filter((a) => a.type !== "credit" && a.type !== "loan")
      .map((a) => ({
        id: a.id,
        name: a.name,
        bucket: a.bucket,
        balance: a.currentCents / 100,
        includeInFI: a.includeInFi && a.bucket !== "excluded",
        ...(a.costBasisCents !== null ? { costBasis: a.costBasisCents / 100 } : {}),
        ...(a.rothBasisCents !== null ? { rothContributionBasis: a.rothBasisCents / 100 } : {}),
      })),
    debts,
    income: [
      ...data.income.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind as EngineInput["income"][number]["kind"],
        personId: s.personId,
        monthly: s.monthlyCents / 100,
        growth: s.growth as "raise" | "inflation" | "none",
        phase: s.phase as "working" | "retired" | "always",
        ...(s.startAge !== null ? { startAge: s.startAge } : {}),
        ...(s.endAge !== null ? { endAge: s.endAge } : {}),
      })),
      ...scenario.extraIncome,
    ],
    contributions: data.contributions.map((c) => ({
      id: c.id,
      name: c.name,
      bucket: c.bucket === "excluded" ? "taxable" : c.bucket,
      monthly: c.monthlyCents / 100,
      growth: c.growth as "raise" | "inflation" | "none",
    })),
    spending: {
      currentAnnual: spend.annual,
      currentEssentialAnnual: spend.essential,
      retirementAdjustments: scenario.retirementAdjustments,
    },
    assumptions: scenario.assumptions,
    debtPlan: scenario.debtPlan,
    policy: scenario.policy,
  };
  try {
    return { input: parseEngineInput(draft), issues };
  } catch (e) {
    // Plain words for the screen; the field paths say where to look.
    const fields =
      e instanceof ZodError
        ? [...new Set(e.issues.map((i) => String(i.path.at(-1) ?? i.path[0] ?? "")).filter(Boolean))]
        : [];
    const message = fields.length
      ? `Some numbers in your plan are out of range (${fields.slice(0, 3).join(", ")}). Open the plan and check them.`
      : "Your plan could not be calculated. Open the plan and check its numbers.";
    issues.push({ code: "invalid", message });
    return { input: null, issues };
  }
}

export interface HouseholdPlan {
  data: HouseholdData;
  scenario: Scenario;
  scenarioRow: ScenarioRow;
  input: EngineInput | null;
  result: PlanResult | null;
  issues: SnapshotIssue[];
  asOf: string;
}

export async function planForScenario(
  ctx: Ctx,
  scenarioId?: string | null,
  asOf = todayISO(),
): Promise<HouseholdPlan> {
  const [data, scenarioRow] = await Promise.all([loadHousehold(ctx, asOf), loadScenario(ctx, scenarioId)]);
  const scenario = readScenario(scenarioRow);
  const { input, issues } = buildEngineInput(data, scenario, asOf);
  return { data, scenario, scenarioRow, input, result: input ? runPlan(input) : null, issues, asOf };
}
