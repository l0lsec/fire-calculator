// Spending review (BUILD_PLAN section 6, T3.6): measured annual spending, the
// review queue, one-time decisions, category rules, and "use as baseline".
import {
  clearOverride,
  type Db,
  deleteCategoryRule,
  getAccount,
  getOverride,
  getTransaction,
  type HouseholdScope,
  listAccounts,
  listCategoryRules,
  listItems,
  setCategoryRule,
  setOverride,
  setSpendingProfile,
  updateAccount,
} from "@fire/db";
import type { AnnualSpending } from "@fire/spending";
import { z } from "zod";
import { type Breakdown, type BreakdownLine, foldSlices } from "@/lib/breakdown";
import { dateText } from "@/lib/format";
import type { ActionResult } from "../forms";
import { deriveHouseholdSpending, hasConnectedAccounts } from "../snapshot";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const FLAG_TEXT: Record<string, string> = {
  "one-time-candidate": "Large or unusual: one-time or recurring?",
  "unlinked-card-payment": "Payment to a card that is not connected: counted as spending",
  "possible-spending": "Cash or a payment to a person: is this spending?",
  uncategorized: "No category from the bank",
};

export function categoryLabel(c: string): string {
  return c
    .replace(
      /^(FOOD_AND_DRINK|GENERAL_MERCHANDISE|GENERAL_SERVICES|RENT_AND_UTILITIES|HOME_IMPROVEMENT|TRANSPORTATION|ENTERTAINMENT|PERSONAL_CARE|GOVERNMENT_AND_NON_PROFIT|MEDICAL|TRAVEL|LOAN_PAYMENTS|BANK_FEES|TRANSFER_OUT|TRANSFER_IN|INCOME)_/,
      "",
    )
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (m) => m.toUpperCase());
}

export async function spendingView(ctx: Ctx, asOf: string) {
  const [s, items, accounts] = await Promise.all([
    deriveHouseholdSpending(ctx, asOf),
    listItems(ctx.db, ctx.scope),
    listAccounts(ctx.db, ctx.scope),
  ]);
  const living = new Map(s.byAccount.map((a) => [a.accountId, a.livingCents]));
  const byAccount = accounts
    .map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      business: a.business,
      livingCents: living.get(a.id) ?? 0,
    }))
    .filter((a) => a.livingCents !== 0 || a.business)
    .sort((a, b) => b.livingCents - a.livingCents);
  return { s, byAccount, connected: items.length > 0 || hasConnectedAccounts({ accounts }) };
}

/** Mark an account as business (its spending is shown apart, still inside the totals) or personal. */
export async function setAccountBusiness(
  ctx: Ctx,
  id: string,
  business: boolean,
): Promise<ActionResult<{ message: string; undo: UndoFields }>> {
  const account = await getAccount(ctx.db, ctx.scope, id);
  if (!account) return { ok: false, error: "Account not found" };
  await updateAccount(ctx.db, ctx.scope, id, { business });
  const message = business
    ? `${account.name} is now a business account. Its spending stays in your totals, on its own line.`
    : `${account.name} is now a personal account.`;
  return { ok: true, data: { message, undo: { id, business: String(account.business) } } };
}

const CLASSES = [
  "living_expense",
  "transfer",
  "debt_payment",
  "investment_contribution",
  "income",
  "ignore",
] as const;

const Decision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("one-time"), transactionId: z.string().uuid() }),
  z.object({ decision: z.literal("recurring"), transactionId: z.string().uuid() }),
  z.object({
    decision: z.literal("amortize"),
    transactionId: z.string().uuid(),
    years: z.coerce.number().int().min(2, "At least 2 years").max(30),
  }),
  z.object({
    decision: z.literal("class"),
    transactionId: z.string().uuid(),
    class: z.enum(CLASSES),
  }),
]);

/** Form fields that put a transaction's override back the way it was (see undoDecision). */
export type UndoFields = Record<string, string>;

/**
 * Record the user's decision on one transaction; it then leaves the review
 * queue. Returns what happened in words and the fields that undo it.
 */
export async function decide(
  ctx: Ctx,
  input: Record<string, string>,
): Promise<ActionResult<{ message: string; undo: UndoFields }>> {
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision" };
  const d = parsed.data;
  const tx = await getTransaction(ctx.db, ctx.scope, d.transactionId);
  if (!tx) return { ok: false, error: "That transaction is gone; reload the page." };
  const before = await getOverride(ctx.db, ctx.scope, d.transactionId);
  const undo: UndoFields = before
    ? {
        transactionId: d.transactionId,
        had: "1",
        class: before.class ?? "",
        essential: before.essential === null ? "" : String(before.essential),
        oneTime: String(before.oneTime),
        amortizeYears: before.amortizeYears === null ? "" : String(before.amortizeYears),
      }
    : { transactionId: d.transactionId, had: "0" };
  let message: string;
  switch (d.decision) {
    case "one-time":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: true, amortizeYears: null });
      message = `${tx.name}: one-time, left out of yearly spending.`;
      break;
    case "recurring":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: false, amortizeYears: null });
      message = `${tx.name}: counted as recurring spending.`;
      break;
    case "amortize":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: false, amortizeYears: d.years });
      message = `${tx.name}: spread over ${d.years} years.`;
      break;
    case "class":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { class: d.class });
      message =
        d.class === "living_expense"
          ? `${tx.name}: kept as spending.`
          : `${tx.name}: not counted as spending.`;
      break;
  }
  return { ok: true, data: { message, undo } };
}

const UndoDecision = z.discriminatedUnion("had", [
  z.object({ had: z.literal("0"), transactionId: z.string().uuid() }),
  z.object({
    had: z.literal("1"),
    transactionId: z.string().uuid(),
    class: z.union([z.enum(CLASSES), z.literal("")]),
    essential: z.enum(["", "true", "false"]),
    oneTime: z.enum(["true", "false"]),
    amortizeYears: z.union([z.literal(""), z.coerce.number().int().min(2).max(30)]),
  }),
]);

/** Put a transaction's override back to what decide() recorded before it changed it. */
export async function undoDecision(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = UndoDecision.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not undo that; change it again from the list." };
  const u = parsed.data;
  if (u.had === "0") {
    await clearOverride(ctx.db, ctx.scope, u.transactionId);
    return { ok: true };
  }
  if (!(await getTransaction(ctx.db, ctx.scope, u.transactionId)))
    return { ok: false, error: "That transaction is gone; nothing to undo." };
  await setOverride(ctx.db, ctx.scope, u.transactionId, {
    class: u.class === "" ? null : u.class,
    essential: u.essential === "" ? null : u.essential === "true",
    oneTime: u.oneTime === "true",
    amortizeYears: u.amortizeYears === "" ? null : u.amortizeYears,
  });
  return { ok: true };
}

const CATEGORY_RE = /^[A-Z_]{3,80}$/;

export async function setCategoryEssential(
  ctx: Ctx,
  pfcDetailed: string,
  essential: boolean,
): Promise<ActionResult<{ message: string; undo: UndoFields }>> {
  if (!CATEGORY_RE.test(pfcDetailed)) return { ok: false, error: "Unknown category" };
  const before = (await listCategoryRules(ctx.db, ctx.scope)).find((r) => r.pfcDetailed === pfcDetailed);
  await setCategoryRule(ctx.db, ctx.scope, pfcDetailed, { class: "living_expense", essential });
  const undo: UndoFields = before
    ? { category: pfcDetailed, had: "1", class: before.class, essential: String(before.essential) }
    : { category: pfcDetailed, had: "0" };
  const message = `${categoryLabel(pfcDetailed)} is now ${essential ? "essential: it counts toward Lean FI" : "discretionary"}.`;
  return { ok: true, data: { message, undo } };
}

const UndoCategory = z.discriminatedUnion("had", [
  z.object({ had: z.literal("0"), category: z.string().regex(CATEGORY_RE) }),
  z.object({
    had: z.literal("1"),
    category: z.string().regex(CATEGORY_RE),
    class: z.enum(CLASSES),
    essential: z.enum(["true", "false"]),
  }),
]);

/** Put a category rule back to what setCategoryEssential() recorded. */
export async function undoCategoryEssential(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = UndoCategory.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not undo that; change it again from the list." };
  const u = parsed.data;
  if (u.had === "0") await deleteCategoryRule(ctx.db, ctx.scope, u.category);
  else
    await setCategoryRule(ctx.db, ctx.scope, u.category, {
      class: u.class,
      essential: u.essential === "true",
    });
  return { ok: true };
}

/** Use measured spending (not a manual estimate) as the plan's spending basis. */
export async function useMeasuredSpending(ctx: Ctx, use: boolean): Promise<ActionResult> {
  await setSpendingProfile(ctx.db, ctx.scope, { source: use ? "plaid" : "manual" });
  return { ok: true };
}

/** What each Spending-page total is made of (the drill-down behind its tiles). */
export function spendingBreakdowns(
  s: AnnualSpending,
): Record<"annual" | "essentials" | "discretionary", Breakdown> {
  const d = (cents: number) => cents / 100;
  const living = d(s.livingCents);
  const essentialLiving = d(s.livingEssentialCents);
  const escrow = d(s.escrowCents);
  const toCategories = { href: "#by-category", label: "By category, below" };
  const measured = {
    label: "Measured over",
    value: `${s.monthsOfData} months, ${dateText(s.windowStart)} to ${dateText(s.windowEnd)}`,
  };
  const escrowLine: BreakdownLine[] = escrow
    ? [{ op: "+", label: "Mortgage escrow", value: escrow, detail: "property tax and insurance, from Debts" }]
    : [];
  return {
    annual: {
      id: "annual",
      title: "Annual spending",
      intro:
        "Everything you spent on living over the last 12 months from your connected accounts, plus mortgage escrow. Transfers, card payments, loan payments and investing are left out.",
      chart: {
        title: "Annual spending by category",
        slices: foldSlices([
          ...s.byCategory.map((c) => ({ label: categoryLabel(c.category), value: d(c.totalCents) })),
          { label: "Mortgage escrow", value: escrow },
        ]),
      },
      steps: [
        {
          lines: [
            { op: "+", label: "Living spending", value: living, detail: "from your connected accounts" },
            ...escrowLine,
          ],
          total: { label: "Annual spending", value: d(s.totalCents) },
        },
        ...(s.businessCents !== 0
          ? [
              {
                title: "Who spent it",
                lines: [
                  { op: "+" as const, label: "Personal", value: living - d(s.businessCents) },
                  {
                    op: "+" as const,
                    label: "Business",
                    value: d(s.businessCents),
                    detail: "from accounts marked as business",
                  },
                ],
                total: { label: "Living spending", value: living },
              },
            ]
          : []),
      ],
      facts: [measured],
      links: [toCategories, { href: "/dashboard#spending", label: "Dashboard" }],
    },
    essentials: {
      id: "essentials",
      title: "Essentials",
      intro:
        "The spending you would keep even on a tight budget: groceries, housing, utilities, insurance and the like. It sets your Lean FI number.",
      chart: {
        title: "Essential and discretionary spending",
        slices: foldSlices([
          { label: "Essential living", value: essentialLiving },
          { label: "Mortgage escrow", value: escrow },
          { label: "Discretionary", value: d(s.discretionaryCents) },
        ]),
      },
      steps: [
        {
          lines: [
            {
              op: "+",
              label: "Essential living spending",
              value: essentialLiving,
              detail: "categories marked essential",
            },
            ...escrowLine,
          ],
          total: { label: "Essentials", value: d(s.essentialCents) },
        },
      ],
      facts: [measured],
      links: [toCategories, { href: "/dashboard#fi-number", label: "Dashboard" }],
    },
    discretionary: {
      id: "discretionary",
      title: "Discretionary",
      intro: "Living spending that is not essential: the part you could cut.",
      steps: [
        {
          lines: [
            { op: "+", label: "Living spending", value: living },
            { op: "-", label: "Essential living spending", value: essentialLiving },
          ],
          total: { label: "Discretionary", value: d(s.discretionaryCents) },
        },
      ],
      facts: [measured],
      links: [toCategories],
    },
  };
}
