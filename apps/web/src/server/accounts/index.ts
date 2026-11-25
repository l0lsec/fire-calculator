// Manual accounts: validation and persistence. Plaid accounts are created by
// the sync; users may change their bucket and FI inclusion but not balances.
import {
  createManualAccount,
  type Db,
  deleteManualAccount,
  getAccount,
  type HouseholdScope,
  listAccounts,
  updateAccount,
} from "@fire/db";
import { z } from "zod";
import { type ActionResult, checkbox, dollars, parseForm } from "../forms";

import { BUCKETS } from "./labels";

export { BUCKET_LABELS, BUCKETS } from "./labels";

export const ManualAccountForm = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(80),
  bucket: z.enum(BUCKETS, { message: "Choose what kind of account this is" }),
  balance: dollars({ max: 100_000_000 }),
  costBasis: dollars({ optional: true, max: 100_000_000 }),
  rothBasis: dollars({ optional: true, max: 100_000_000 }),
  includeInFi: checkbox,
});

export const AccountEditForm = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bucket: z.enum(BUCKETS).optional(),
  includeInFi: checkbox,
});

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export async function saveManualAccount(
  ctx: Ctx,
  input: Record<string, string>,
  id?: string,
): Promise<ActionResult> {
  const parsed = parseForm(ManualAccountForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  const values = {
    name: v.name,
    bucket: v.bucket,
    currentCents: v.balance as number,
    costBasisCents: v.costBasis,
    rothBasisCents: v.rothBasis,
    includeInFi: v.bucket === "excluded" ? false : v.includeInFi,
  };
  if (id) {
    const existing = await getAccount(ctx.db, ctx.scope, id);
    if (!existing) return { ok: false, error: "Account not found" };
    if (existing.source === "plaid") {
      // Connected balances come from the bank; only classification is editable.
      await updateAccount(ctx.db, ctx.scope, id, {
        name: v.name,
        bucket: v.bucket,
        includeInFi: values.includeInFi,
      });
      return { ok: true };
    }
    await updateAccount(ctx.db, ctx.scope, id, values);
    return { ok: true };
  }
  await createManualAccount(ctx.db, ctx.scope, { ...values, type: "manual", subtype: null });
  return { ok: true };
}

export async function removeManualAccount(ctx: Ctx, id: string): Promise<ActionResult> {
  const ok = await deleteManualAccount(ctx.db, ctx.scope, id);
  return ok ? { ok: true } : { ok: false, error: "Only manual accounts can be deleted" };
}

export async function accountsForDisplay(ctx: Ctx) {
  const rows = await listAccounts(ctx.db, ctx.scope);
  // Credit cards and loans are shown as debts, not assets.
  return rows.filter((a) => a.type !== "credit" && a.type !== "loan");
}
