// Debts: validation and persistence. Rates are entered as percents.
import {
  createDebt,
  type Db,
  deleteDebt,
  getDebt,
  type HouseholdScope,
  listDebts,
  updateDebt,
} from "@fire/db";
import { DebtKind, MinPaymentRule, monthIndex } from "@fire/engine/core";
import { z } from "zod";
import { type ActionResult, dollars, parseForm, percent } from "../forms";

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  credit_card: "Credit card",
  student: "Student loan",
  mortgage: "Mortgage",
  auto: "Auto loan",
  personal: "Personal loan",
  heloc: "HELOC",
  medical: "Medical debt",
  other: "Other",
};

const promoMonth = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Use YYYY-MM" });
      return z.NEVER;
    }
    return monthIndex(Number(m[1]), Number(m[2]));
  });

export const DebtForm = z
  .object({
    name: z.string().trim().min(1, "Give the debt a name").max(80),
    kind: DebtKind,
    balance: dollars({ max: 100_000_000 }),
    apr: percent({ max: 100, optional: true }),
    minType: z.enum(["fixed", "card"]).default("fixed"),
    minAmount: dollars({ optional: true, max: 1_000_000 }),
    cardFloor: dollars({ optional: true, max: 10_000 }),
    cardPct: percent({ max: 100, optional: true }),
    promoApr: percent({ max: 100, optional: true }),
    promoEnds: promoMonth,
    escrow: dollars({ optional: true, max: 100_000 }),
  })
  .superRefine((v, ctx) => {
    if (v.minType === "fixed" && v.minAmount === null) {
      ctx.addIssue({ code: "custom", path: ["minAmount"], message: "Enter the minimum monthly payment" });
    }
    if (v.minType === "card" && v.cardPct === null) {
      ctx.addIssue({ code: "custom", path: ["cardPct"], message: "Enter the percent of balance" });
    }
    if ((v.promoApr === null) !== (v.promoEnds === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["promoEnds"],
        message: "A promo rate needs both a rate and an end month",
      });
    }
    if (v.escrow && v.kind !== "mortgage") {
      ctx.addIssue({ code: "custom", path: ["escrow"], message: "Escrow applies to mortgages only" });
    }
  });

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export function minRuleFrom(v: z.infer<typeof DebtForm>): MinPaymentRule {
  return v.minType === "card"
    ? { type: "card", floor: (v.cardFloor ?? 3500) / 100, pct: v.cardPct ?? 0.01 }
    : { type: "fixed", amount: (v.minAmount ?? 0) / 100 };
}

export async function saveDebt(ctx: Ctx, input: Record<string, string>, id?: string): Promise<ActionResult> {
  const parsed = parseForm(DebtForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  const values = {
    name: v.name,
    kind: v.kind,
    balanceCents: v.balance as number,
    apr: v.apr,
    minPaymentRule: MinPaymentRule.parse(minRuleFrom(v)),
    promoApr: v.promoApr,
    promoEndsMonth: v.promoEnds,
    escrowMonthlyCents: v.escrow ?? 0,
  };
  if (id) {
    const existing = await getDebt(ctx.db, ctx.scope, id);
    if (!existing) return { ok: false, error: "Debt not found" };
    await updateDebt(ctx.db, ctx.scope, id, values);
    return { ok: true };
  }
  await createDebt(ctx.db, ctx.scope, values);
  return { ok: true };
}

const DebtRateForm = z.object({
  id: z.string().uuid("Debt not found"),
  apr: percent({ max: 100 }),
});

/** Set only a debt's interest rate (the dashboard's inline "rate needed" box). */
export async function setDebtRate(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = parseForm(DebtRateForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  if (!(await getDebt(ctx.db, ctx.scope, v.id))) return { ok: false, error: "Debt not found" };
  await updateDebt(ctx.db, ctx.scope, v.id, { apr: v.apr });
  return { ok: true };
}

export async function removeDebt(ctx: Ctx, id: string): Promise<ActionResult> {
  const existing = await getDebt(ctx.db, ctx.scope, id);
  if (!existing) return { ok: false, error: "Debt not found" };
  if (existing.accountId)
    return { ok: false, error: "Connected debts are removed by disconnecting the bank" };
  await deleteDebt(ctx.db, ctx.scope, id);
  return { ok: true };
}

export async function debtsForDisplay(ctx: Ctx) {
  return listDebts(ctx.db, ctx.scope);
}
