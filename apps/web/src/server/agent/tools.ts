// The tools an AI assistant can call, shared by the MCP endpoint (/api/mcp)
// and the REST API (/api/v1/tools/<name>). Each tool reuses the same server
// functions the pages use, so an assistant sees exactly the numbers the
// dashboard shows. Money goes out in dollars; dates are YYYY-MM-DD.
//
// Write tools are limited on purpose: they never change the baseline plan
// (what-ifs go into copies), never delete stored data, and never move money
// (the app has no payment code at all).
import { type Db, type HouseholdScope, listAccounts, listTransactions } from "@fire/db";
import { z } from "zod";
import { compareScenarios, investVsPrepay } from "../compare";
import { dashboardModel } from "../dashboard";
import { debtsForDisplay, setDebtRate } from "../debts";
import { exportHousehold, netWorthHistory } from "../export";
import type { ActionResult } from "../forms";
import { categoryName, dismissAlert, loadInsights, saveBudget } from "../insights";
import { addAdjustment, allScenarios, duplicateScenario, readScenario } from "../scenarios";
import { planForScenario, todayISO } from "../snapshot";
import { categoryLabel, decide, FLAG_TEXT, spendingView } from "../spending";

export interface ToolCtx {
  db: Db;
  scope: HouseholdScope;
}

export type ToolAccess = "read" | "write";

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  access: ToolAccess;
  input: S;
  run: (ctx: ToolCtx, args: z.infer<S>) => Promise<unknown>;
}

/** A tool refused the request in a way the assistant can fix (bad id, out-of-range value). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

const tool = <S extends z.ZodType>(t: Tool<S>): Tool => t as unknown as Tool;

const usd = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const ID = z.string().uuid();

function plainResult<T>(r: ActionResult<T>, fallback: string): T | { ok: true } {
  if (r.ok) return (r.data ?? { ok: true }) as T | { ok: true };
  const fields = r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, v]) => `${k}: ${v}`) : [];
  throw new ToolError(r.error ?? (fields.length ? fields.join("; ") : fallback));
}

function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function baselineIfBaseline(ctx: ToolCtx, scenarioId: string) {
  const list = await allScenarios(ctx);
  const row = list.find((s) => s.id === scenarioId);
  if (!row) throw new ToolError("No scenario with that id. Call list_scenarios to see the ids.");
  if (row.isBaseline)
    throw new ToolError(
      "That is the baseline plan, which AI keys cannot change. Call create_scenario to make a what-if copy, then change the copy.",
    );
  return row;
}

// ---------- read tools ----------

const getOverview = tool({
  name: "get_overview",
  title: "FI overview",
  description:
    "The dashboard's answer to 'when am I financially independent?': FI number, projected FI date and age, portfolio, net worth, savings rate, spending, every FI level (Coast, Lean, Barista, FI, Fat, debt-free) with its target and projected date, plus problems that make the plan incomplete. Uses the baseline plan unless scenarioId is given.",
  access: "read",
  input: z.object({
    scenarioId: ID.optional().describe("A scenario id from list_scenarios; omit for the baseline plan"),
  }),
  run: async (ctx, { scenarioId }) => {
    const plan = await planForScenario(ctx, scenarioId ?? null);
    const m = dashboardModel(plan);
    return {
      asOf: plan.asOf,
      scenario: { id: plan.scenario.id, name: m.scenarioName, isBaseline: plan.scenario.isBaseline },
      ready: m.ready,
      issues: m.issues.map((i) => i.message),
      headline: m.headline,
      levels: m.ladder.map((l) => ({
        level: l.label,
        isDebt: l.isDebt,
        target: l.target,
        current: l.current,
        progress: Math.round(l.progress * 1000) / 1000,
        status: l.status,
        when: l.when,
        age: l.age,
      })),
      assumptions: m.chips,
      earlyAccess: m.access,
      withdrawalTax: m.tax,
      warnings: m.warnings,
      // One point a year keeps the trajectory small enough to reason about.
      trajectory: m.chart
        .filter((_, i) => i % 12 === 0)
        .map((p) => ({
          when: p.label,
          age: p.age,
          portfolio: p.portfolio,
          fiTarget: p.fi,
          retired: p.retired,
        })),
      note: "Estimates for education and planning, based on the user's assumptions. Not financial advice.",
    };
  },
});

const listAccountsTool = tool({
  name: "list_accounts",
  title: "Accounts and balances",
  description:
    "Every asset account (cash, taxable, traditional, Roth, HSA) with its current balance, tax bucket, whether it counts toward FI, and where it comes from (bank link, iPhone, manual). Cards and loans are in list_debts.",
  access: "read",
  input: z.object({}),
  run: async (ctx) => {
    const rows = await listAccounts(ctx.db, ctx.scope);
    return rows
      .filter((a) => a.type !== "credit" && a.type !== "loan")
      .map((a) => ({
        id: a.id,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        bucket: a.bucket,
        balance: usd(a.currentCents),
        available: usd(a.availableCents),
        countsTowardFi: a.includeInFi,
        business: a.business,
        source: a.source,
      }));
  },
});

const listDebtsTool = tool({
  name: "list_debts",
  title: "Debts",
  description:
    "Every debt (cards, student, mortgage, auto, personal, HELOC, medical) with balance, APR and where the APR came from. An APR of null means the rate is unknown and the plan needs it (set_debt_rate).",
  access: "read",
  input: z.object({}),
  run: async (ctx) => {
    const rows = await debtsForDisplay(ctx);
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      balance: usd(d.balanceCents),
      aprPercent: d.apr == null ? null : Math.round(d.apr * 1e6) / 1e4,
      aprSource: d.aprSource,
      promoAprPercent: d.promoApr == null ? null : Math.round(d.promoApr * 1e6) / 1e4,
      minPaymentRule: d.minPaymentRule,
      escrowMonthly: usd(d.escrowMonthlyCents),
      connected: d.accountId !== null,
    }));
  },
});

const getSpending = tool({
  name: "get_spending",
  title: "Measured spending",
  description:
    "Yearly spending measured from connected accounts over the last 12 months: total, essential vs discretionary, by category, by month, by account, plus the transactions waiting for a decision in the spending review (use review_transaction to decide them).",
  access: "read",
  input: z.object({
    reviewLimit: z.number().int().min(0).max(200).default(25).describe("How many review items to include"),
  }),
  run: async (ctx, { reviewLimit }) => {
    const asOf = todayISO();
    const { s, byAccount, connected } = await spendingView(ctx, asOf);
    return {
      connected,
      window: { start: s.windowStart, end: s.windowEnd, monthsOfData: s.monthsOfData },
      annual: {
        living: usd(s.livingCents),
        essential: usd(s.livingEssentialCents),
        discretionary: usd(s.discretionaryCents),
        escrow: usd(s.escrowCents),
        total: usd(s.totalCents),
        income: usd(s.incomeCents),
        investmentContributions: usd(s.investmentContributionCents),
        debtPayments: usd(s.debtPaymentCents),
        business: usd(s.businessCents),
      },
      byCategory: s.byCategory
        .slice()
        .sort((a, b) => b.totalCents - a.totalCents)
        .map((c) => ({
          category: c.category,
          label: categoryLabel(c.category),
          essential: c.essential,
          total: usd(c.totalCents),
        })),
      monthly: s.monthly.map((m) => ({ month: m.month, living: usd(m.livingCents) })),
      byAccount: byAccount.map((a) => ({
        id: a.id,
        name: a.name,
        business: a.business,
        living: usd(a.livingCents),
      })),
      review: {
        waiting: s.reviewQueue.length,
        items: s.reviewQueue.slice(0, reviewLimit).map((r) => ({
          transactionId: r.transactionId,
          date: r.date,
          name: r.name,
          amount: usd(r.amountCents),
          question: FLAG_TEXT[r.flag] ?? r.flag,
        })),
      },
      warnings: s.warnings,
    };
  },
});

const listTransactionsTool = tool({
  name: "list_transactions",
  title: "Transactions",
  description:
    "Bank and card transactions between two dates, newest first. Positive amounts are money out, negative are money in. Filter by text in the name or merchant, or by category.",
  access: "read",
  input: z.object({
    from: DATE.optional().describe("Start date, YYYY-MM-DD (default 30 days ago)"),
    to: DATE.optional().describe("End date, YYYY-MM-DD (default today)"),
    search: z.string().max(80).optional().describe("Case-insensitive text to find in the name or merchant"),
    category: z
      .string()
      .max(80)
      .optional()
      .describe("Plaid category, primary or detailed (e.g. FOOD_AND_DRINK)"),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  run: async (ctx, { from, to, search, category, limit }) => {
    const end = to ?? todayISO();
    const start = from ?? daysBefore(end, 30);
    if (start > end) throw new ToolError("'from' must be on or before 'to'.");
    const [txs, accounts] = await Promise.all([
      listTransactions(ctx.db, ctx.scope, start, end),
      listAccounts(ctx.db, ctx.scope, { includeArchived: true }),
    ]);
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const q = search?.toLowerCase();
    const filtered = txs
      .filter((t) => !q || `${t.name} ${t.merchant ?? ""}`.toLowerCase().includes(q))
      .filter((t) => !category || t.pfcPrimary === category || t.pfcDetailed === category)
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate));
    return {
      from: start,
      to: end,
      matched: filtered.length,
      transactions: filtered.slice(0, limit).map((t) => ({
        id: t.id,
        date: t.postedDate,
        name: t.name,
        merchant: t.merchant,
        amount: usd(t.amountCents),
        category: t.pfcDetailed ?? t.pfcPrimary,
        account: names.get(t.accountId) ?? null,
        pending: t.pending,
      })),
    };
  },
});

const getBudgetsAndBills = tool({
  name: "get_budgets_and_bills",
  title: "Budgets, bills and alerts",
  description:
    "This month's budgets against spending so far, recurring subscriptions and bills (with the next expected charge), bills due in the next 14 days, this week's spending against last week, and open alerts.",
  access: "read",
  input: z.object({}),
  run: async (ctx) => {
    const i = await loadInsights(ctx);
    const series = (xs: typeof i.recurring.bills) =>
      xs.map((s) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        monthly: usd(s.monthlyCents),
        nextDate: s.nextDate,
        active: s.active,
      }));
    return {
      asOf: i.asOf,
      budgets: i.budgets.map((b) => ({
        category: b.category,
        label: categoryName(b.category),
        budget: usd(b.budgetCents),
        spentThisMonth: usd(b.spentCents),
        typicalMonth: usd(b.averageCents),
      })),
      subscriptions: series(i.recurring.subscriptions),
      bills: series(i.recurring.bills),
      upcoming: series(i.recurring.upcoming),
      monthlyRecurring: {
        subscriptions: usd(i.recurring.subscriptionMonthlyCents),
        bills: usd(i.recurring.billMonthlyCents),
      },
      week: { spent: usd(i.week.spentCents), previousWeek: usd(i.week.previousCents) },
      alerts: i.alerts.map((a) => ({
        key: a.key,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
        date: a.date,
        amount: usd(a.amountCents),
      })),
    };
  },
});

const listScenariosTool = tool({
  name: "list_scenarios",
  title: "Scenarios",
  description:
    "The baseline plan and every what-if scenario, with their assumptions (returns, inflation, withdrawal rate, retirement age), debt plan and retirement spending changes.",
  access: "read",
  input: z.object({}),
  run: async (ctx) => {
    const rows = await allScenarios(ctx);
    return rows.map((row) => {
      const s = readScenario(row);
      return {
        id: s.id,
        name: s.name,
        isBaseline: s.isBaseline,
        assumptions: s.assumptions,
        debtPlan: s.debtPlan,
        debtPolicy: s.policy,
        retirementAdjustments: s.retirementAdjustments,
        spendingOverride: usd(s.spendingOverrideCents),
      };
    });
  },
});

const compareScenariosTool = tool({
  name: "compare_scenarios",
  title: "Compare scenarios",
  description:
    "Side by side for up to 4 scenarios: months to each FI level, FI number, total debt interest, Monte Carlo success rate and historical success (1871 onward). Deltas are against the first scenario listed.",
  access: "read",
  input: z.object({
    scenarioIds: z
      .array(ID)
      .min(1)
      .max(4)
      .describe("Scenario ids from list_scenarios; the first is the reference"),
  }),
  run: async (ctx, { scenarioIds }) => compareScenarios(ctx, scenarioIds),
});

const investVsPrepayTool = tool({
  name: "invest_vs_prepay",
  title: "Invest or prepay a debt",
  description:
    "Whether an extra monthly amount reaches FI sooner when it prepays one debt or stays invested. Returns months to FI, debt-free month and total interest both ways.",
  access: "read",
  input: z.object({
    debtId: ID.describe("A debt id from list_debts"),
    extraMonthly: z.number().positive().max(1_000_000).describe("Extra dollars per month"),
    scenarioId: ID.optional().describe("Omit for the baseline plan"),
  }),
  run: async (ctx, { debtId, extraMonthly, scenarioId }) => {
    const plan = await planForScenario(ctx, scenarioId ?? null);
    if (!plan.input)
      throw new ToolError(
        `The plan cannot be calculated yet: ${plan.issues.map((i) => i.message).join(" ") || "check get_overview"}`,
      );
    if (!plan.input.debts.some((d) => d.id === debtId))
      throw new ToolError("No debt with that id in this plan. Call list_debts to see the ids.");
    return investVsPrepay(plan.input, debtId, extraMonthly);
  },
});

const getNetWorthHistory = tool({
  name: "get_net_worth_history",
  title: "Net worth history",
  description: "Net worth by day from stored balance snapshots (assets minus card and loan balances).",
  access: "read",
  input: z.object({
    from: DATE.optional().describe("Default one year ago"),
    to: DATE.optional().describe("Default today"),
  }),
  run: async (ctx, { from, to }) => {
    const end = to ?? todayISO();
    const rows = await netWorthHistory(ctx, from ?? daysBefore(end, 365), end);
    // Weekly points are plenty for trends and keep the answer small.
    const sampled = rows.filter((_, i) => i % 7 === 0 || i === rows.length - 1);
    return sampled.map((r) => ({ date: r.date, netWorth: usd(r.netWorthCents) }));
  },
});

const getHouseholdProfile = tool({
  name: "get_household_profile",
  title: "Household profile",
  description:
    "Everything the plan is built from, except transactions: people and birth months, income streams, savings contributions, spending basis, accounts, debts and scenarios, in the app's export format.",
  access: "read",
  input: z.object({}),
  run: async (ctx) => {
    const { transactions: _omit, ...rest } = await exportHousehold(ctx);
    return rest;
  },
});

// ---------- write tools ----------

const createScenarioTool = tool({
  name: "create_scenario",
  title: "Create a what-if scenario",
  description:
    "Copy a scenario (the baseline by default) into a new what-if the assistant can change with add_scenario_adjustment. The baseline plan itself is never changed.",
  access: "write",
  input: z.object({
    name: z.string().trim().min(1).max(80).describe("Name for the what-if, e.g. 'Retire at 50'"),
    fromScenarioId: ID.optional().describe("Scenario to copy; omit for the baseline"),
  }),
  run: async (ctx, { name, fromScenarioId }) => {
    const list = await allScenarios(ctx);
    const from = fromScenarioId ? list.find((s) => s.id === fromScenarioId) : list.find((s) => s.isBaseline);
    if (!from) throw new ToolError("No scenario with that id. Call list_scenarios to see the ids.");
    const r = await duplicateScenario(ctx, from.id, name);
    if (!r.ok || !r.data)
      throw new ToolError(
        r.ok ? "Could not copy the scenario." : (r.error ?? "Could not copy the scenario."),
      );
    return {
      scenarioId: r.data.id,
      message: `Created "${name}" from "${from.name}". Change it with add_scenario_adjustment, then compare_scenarios.`,
    };
  },
});

const addScenarioAdjustment = tool({
  name: "add_scenario_adjustment",
  title: "Change retirement spending in a what-if",
  description:
    "Add a yearly retirement spending change to a what-if scenario (not the baseline), e.g. +12000 for travel from 55 to 70, or -6000 once the mortgage is gone. Negative amounts reduce spending.",
  access: "write",
  input: z.object({
    scenarioId: ID.describe("A non-baseline scenario id (create_scenario makes one)"),
    label: z.string().trim().min(1).max(80),
    annualAmount: z
      .number()
      .min(-10_000_000)
      .max(10_000_000)
      .describe("Dollars per year; negative reduces spending"),
    essential: z.boolean().default(false).describe("True if it counts toward Lean FI"),
    fromAge: z.number().min(0).max(120).optional(),
    untilAge: z.number().min(0).max(120).optional(),
  }),
  run: async (ctx, a) => {
    const row = await baselineIfBaseline(ctx, a.scenarioId);
    plainResult(
      await addAdjustment(ctx, row.id, {
        label: a.label,
        annual: String(a.annualAmount),
        ...(a.essential ? { essential: "on" } : {}),
        ...(a.fromAge !== undefined ? { fromAge: String(a.fromAge) } : {}),
        ...(a.untilAge !== undefined ? { untilAge: String(a.untilAge) } : {}),
      }),
      "Could not add that change.",
    );
    return { ok: true, message: `Added "${a.label}" to "${row.name}". See the effect with get_overview.` };
  },
});

const setBudgetTool = tool({
  name: "set_budget",
  title: "Set a monthly budget",
  description:
    "Set or clear the monthly budget for one spending category (primary Plaid category such as FOOD_AND_DRINK; see get_budgets_and_bills). Pass null to clear it.",
  access: "write",
  input: z.object({
    category: z.string().regex(/^[A-Z_]{3,60}$/, "Use a category like FOOD_AND_DRINK"),
    monthlyAmount: z
      .number()
      .min(0)
      .max(10_000_000)
      .nullable()
      .describe("Dollars per month, or null to clear"),
  }),
  run: async (ctx, { category, monthlyAmount }) => {
    plainResult(
      await saveBudget(ctx, { category, amount: monthlyAmount === null ? "" : String(monthlyAmount) }),
      "Could not set that budget.",
    );
    return {
      ok: true,
      message:
        monthlyAmount === null
          ? `Cleared the ${categoryName(category)} budget.`
          : `${categoryName(category)} budget set to $${monthlyAmount.toLocaleString("en-US")} a month.`,
    };
  },
});

const setDebtRateTool = tool({
  name: "set_debt_rate",
  title: "Set a debt's interest rate",
  description: "Set the APR of one debt (needed when list_debts shows aprPercent null). Percent, e.g. 24.99.",
  access: "write",
  input: z.object({
    debtId: ID,
    aprPercent: z.number().min(0).max(100),
  }),
  run: async (ctx, { debtId, aprPercent }) => {
    plainResult(await setDebtRate(ctx, { id: debtId, apr: String(aprPercent) }), "Could not set that rate.");
    return { ok: true, message: `APR set to ${aprPercent}%.` };
  },
});

const reviewTransaction = tool({
  name: "review_transaction",
  title: "Decide a spending review item",
  description:
    "Answer one spending-review question from get_spending: 'one-time' (leave out of yearly spending), 'recurring' (count it), 'amortize' (spread over N years), or 'class' (re-classify: living_expense, transfer, debt_payment, investment_contribution, income, ignore). The user can undo it from the Spending page.",
  access: "write",
  input: z.object({
    transactionId: ID,
    decision: z.enum(["one-time", "recurring", "amortize", "class"]),
    years: z.number().int().min(2).max(30).optional().describe("Required for 'amortize'"),
    class: z
      .enum(["living_expense", "transfer", "debt_payment", "investment_contribution", "income", "ignore"])
      .optional()
      .describe("Required for 'class'"),
  }),
  run: async (ctx, a) => {
    if (a.decision === "amortize" && a.years === undefined)
      throw new ToolError("'amortize' needs years (2 to 30).");
    if (a.decision === "class" && a.class === undefined) throw new ToolError("'class' needs a class.");
    const r = await decide(ctx, {
      transactionId: a.transactionId,
      decision: a.decision,
      ...(a.years !== undefined ? { years: String(a.years) } : {}),
      ...(a.class !== undefined ? { class: a.class } : {}),
    });
    const data = plainResult(r, "Could not record that decision.");
    return { ok: true, message: "message" in data ? data.message : "Recorded." };
  },
});

const dismissAlertTool = tool({
  name: "dismiss_alert",
  title: "Dismiss an alert",
  description:
    "Dismiss one open alert by its key from get_budgets_and_bills. The user can bring it back from Alerts.",
  access: "write",
  input: z.object({ key: z.string().min(3).max(300) }),
  run: async (ctx, { key }) => {
    plainResult(await dismissAlert(ctx, key), "Could not dismiss that alert.");
    return { ok: true, message: "Alert dismissed." };
  },
});

export const TOOLS: readonly Tool[] = [
  getOverview,
  listAccountsTool,
  listDebtsTool,
  getSpending,
  listTransactionsTool,
  getBudgetsAndBills,
  listScenariosTool,
  compareScenariosTool,
  investVsPrepayTool,
  getNetWorthHistory,
  getHouseholdProfile,
  createScenarioTool,
  addScenarioAdjustment,
  setBudgetTool,
  setDebtRateTool,
  reviewTransaction,
  dismissAlertTool,
];

export const toolsFor = (access: ToolAccess) =>
  TOOLS.filter((t) => access === "write" || t.access === "read");
export const findTool = (name: string) => TOOLS.find((t) => t.name === name);

export function inputJsonSchema(t: Tool): Record<string, unknown> {
  const { $schema: _s, ...schema } = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
  return schema;
}

export type CallOutcome =
  | { ok: true; result: unknown }
  | { ok: false; kind: "unknown-tool" | "forbidden" | "invalid" | "refused" | "failed"; message: string };

/** Validate and run one tool for a key with the given access. Never throws. */
export async function callTool(
  ctx: ToolCtx,
  access: ToolAccess,
  name: string,
  args: unknown,
): Promise<CallOutcome> {
  const t = findTool(name);
  if (!t) return { ok: false, kind: "unknown-tool", message: `No tool named "${name}".` };
  if (t.access === "write" && access !== "write")
    return {
      ok: false,
      kind: "forbidden",
      message: `${name} changes data, and this key is read-only. Make a key with "Read and make changes" on the AI access page.`,
    };
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, kind: "invalid", message: msg };
  }
  try {
    return { ok: true, result: await t.run(ctx, parsed.data) };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, kind: "refused", message: e.message };
    console.error(`ai tool ${name} failed`, e instanceof Error ? e.name : "error");
    return {
      ok: false,
      kind: "failed",
      message: "The app could not finish that. Try again, or check the app.",
    };
  }
}
