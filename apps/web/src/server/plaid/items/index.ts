// Item health (BUILD_PLAN section 5, T3.7): status per Item, update mode,
// disconnect with /item/remove, and delete-my-data.
import {
  archiveDebtsForAccounts,
  type Db,
  deleteItem,
  getItem,
  type HouseholdScope,
  listAccounts,
  listItems,
  purgeHousehold,
  updateItem,
} from "@fire/db";
import { PlaidApiError } from "@fire/plaid";
import { type PlaidDeps, withAccessToken } from "../config";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const STATUS_TEXT: Record<string, string> = {
  healthy: "Connected",
  login_required: "Sign-in needed",
  pending_disconnect: "Reconnect soon",
  revoked: "Access revoked",
  error: "Error",
};

export async function itemsForDisplay(ctx: Ctx) {
  const [items, accounts] = await Promise.all([
    listItems(ctx.db, ctx.scope),
    listAccounts(ctx.db, ctx.scope, { includeArchived: true }),
  ]);
  return items.map((i) => ({
    id: i.id,
    institution: i.institutionName ?? "Bank",
    status: i.status,
    statusText: STATUS_TEXT[i.status] ?? i.status,
    errorCode: i.errorCode,
    needsUpdate:
      i.status === "login_required" ||
      i.status === "pending_disconnect" ||
      i.errorCode === "NEW_ACCOUNTS_AVAILABLE",
    newAccounts: i.errorCode === "NEW_ACCOUNTS_AVAILABLE",
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    consentExpiresAt: i.consentExpiresAt?.toISOString() ?? null,
    accounts: accounts
      .filter((a) => a.itemId === i.id && !a.archived)
      .map((a) => `${a.name}${a.mask ? ` ...${a.mask}` : ""}`),
  }));
}

/** Disconnect: tell Plaid to revoke the token, then remove the Item locally (accounts kept, archived). */
export async function disconnectItem(
  ctx: Ctx,
  deps: PlaidDeps,
  itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const item = await getItem(ctx.db, ctx.scope, itemId);
  if (!item) return { ok: false, error: "Connection not found" };
  try {
    await withAccessToken(deps.ring, item, (token) => deps.plaid.itemRemove(token));
  } catch (e) {
    // Already removed or revoked at Plaid: proceed with local removal.
    if (!(e instanceof PlaidApiError && ["INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND"].includes(e.errorCode)))
      throw e;
  }
  const accountIds = (await listAccounts(ctx.db, ctx.scope, { includeArchived: true }))
    .filter((a) => a.itemId === item.id)
    .map((a) => a.id);
  await archiveDebtsForAccounts(ctx.db, ctx.scope, accountIds);
  await deleteItem(ctx.db, ctx.scope, item.id);
  return { ok: true };
}

/** Delete everything: revoke every Item at Plaid, then purge every household row. */
export async function deleteAllData(ctx: Ctx, deps: PlaidDeps | null): Promise<number> {
  if (deps) {
    for (const item of await listItems(ctx.db, ctx.scope)) {
      try {
        await withAccessToken(deps.ring, item, (token) => deps.plaid.itemRemove(token));
      } catch {
        // Best effort: the local purge proceeds regardless.
      }
    }
  }
  return purgeHousehold(ctx.db, ctx.scope, "user requested deletion");
}

/**
 * After Plaid Link update mode succeeds, the user has fixed the login, but
 * Plaid's backend can report ITEM_LOGIN_REQUIRED for a few more seconds. Mark
 * the Item healthy, then sync, retrying briefly before accepting a login error.
 */
export async function completeUpdateMode(
  ctx: Ctx,
  deps: PlaidDeps,
  itemId: string,
  opts: { waitsMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
) {
  const { syncItem } = await import("../sync");
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  await updateItem(ctx.db, ctx.scope, itemId, { status: "healthy", errorCode: null });
  let report = await syncItem(ctx, deps, itemId);
  for (const ms of opts.waitsMs ?? [2000, 4000, 8000]) {
    if (report.status !== "login_required") break;
    await sleep(ms);
    report = await syncItem(ctx, deps, itemId);
  }
  return report;
}
