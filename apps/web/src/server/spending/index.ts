// Spending review (BUILD_PLAN section 6, T3.6): measured annual spending, the
// review queue, one-time decisions, category rules, and "use as baseline".
import {
  type Db,
  getAccount,
  getTransaction,
  type HouseholdScope,
  listAccounts,
  listItems,
  setCategoryRule,
  setOverride,
  setSpendingProfile,
  updateAccount,
} from "@fire/db";
import { z } from "zod";
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
export async function setAccountBusiness(ctx: Ctx, id: string, business: boolean): Promise<ActionResult> {
  const account = await getAccount(ctx.db, ctx.scope, id);
  if (!account) return { ok: false, error: "Account not found" };
  await updateAccount(ctx.db, ctx.scope, id, { business });
  return { ok: true };
}

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
    class: z.enum([
      "living_expense",
      "transfer",
      "debt_payment",
      "investment_contribution",
      "income",
      "ignore",
    ]),
  }),
]);

/** Record the user's decision on one transaction; it then leaves the review queue. */
export async function decide(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision" };
  const d = parsed.data;
  if (!(await getTransaction(ctx.db, ctx.scope, d.transactionId)))
    return { ok: false, error: "Transaction not found" };
  switch (d.decision) {
    case "one-time":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: true, amortizeYears: null });
      break;
    case "recurring":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: false, amortizeYears: null });
      break;
    case "amortize":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { oneTime: false, amortizeYears: d.years });
      break;
    case "class":
      await setOverride(ctx.db, ctx.scope, d.transactionId, { class: d.class });
      break;
  }
  return { ok: true };
}

export async function setCategoryEssential(
  ctx: Ctx,
  pfcDetailed: string,
  essential: boolean,
): Promise<ActionResult> {
  if (!/^[A-Z_]{3,80}$/.test(pfcDetailed)) return { ok: false, error: "Unknown category" };
  await setCategoryRule(ctx.db, ctx.scope, pfcDetailed, { class: "living_expense", essential });
  return { ok: true };
}

/** Use measured spending (not a manual estimate) as the plan's spending basis. */
export async function useMeasuredSpending(ctx: Ctx, use: boolean): Promise<ActionResult> {
  await setSpendingProfile(ctx.db, ctx.scope, { source: use ? "plaid" : "manual" });
  return { ok: true };
}
