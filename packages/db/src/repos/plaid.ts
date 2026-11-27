// Plaid Items and the sync/webhook audit log.
import { and, asc, eq } from "drizzle-orm";
import { type Db, type HouseholdScope, isUuid } from "../db";
import { accounts, plaidItems, syncEvents } from "../schema";

export type ItemRow = typeof plaidItems.$inferSelect;
export type ItemStatus = ItemRow["status"];

export interface NewItem {
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string | null;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  keyVersion: number;
}

export async function createItem(db: Db, scope: HouseholdScope, v: NewItem) {
  const [row] = await db
    .insert(plaidItems)
    .values({ ...v, householdId: scope.householdId })
    .returning();
  return row!;
}

export async function listItems(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(plaidItems)
    .where(eq(plaidItems.householdId, scope.householdId))
    .orderBy(asc(plaidItems.createdAt));
}

export async function getItem(db: Db, scope: HouseholdScope, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(plaidItems)
    .where(and(eq(plaidItems.id, id), eq(plaidItems.householdId, scope.householdId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * System lookup for webhooks and cron: which household owns this Plaid Item?
 * Unscoped by necessity; callers turn the result into a scope.
 */
export async function findItemByPlaidId(db: Db, plaidItemId: string) {
  const rows = await db.select().from(plaidItems).where(eq(plaidItems.plaidItemId, plaidItemId)).limit(1);
  return rows[0] ?? null;
}

/** System listing for the daily safety sync. */
export async function listHealthyItemsForSync(db: Db) {
  return db
    .select({ id: plaidItems.id, householdId: plaidItems.householdId, plaidItemId: plaidItems.plaidItemId })
    .from(plaidItems)
    .where(eq(plaidItems.status, "healthy"));
}

export async function updateItem(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Partial<
    Pick<
      ItemRow,
      | "transactionsCursor"
      | "status"
      | "errorCode"
      | "consentExpiresAt"
      | "lastSyncedAt"
      | "accessTokenCiphertext"
      | "accessTokenIv"
      | "keyVersion"
      | "institutionName"
      | "institutionUrl"
      | "institutionId"
    >
  >,
) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(plaidItems)
    .set(patch)
    .where(and(eq(plaidItems.id, id), eq(plaidItems.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

/** Delete an Item; its accounts stay (archived) so history is not silently lost. */
export async function deleteItem(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ archived: true })
      .where(and(eq(accounts.itemId, id), eq(accounts.householdId, scope.householdId)));
    const rows = await tx
      .delete(plaidItems)
      .where(and(eq(plaidItems.id, id), eq(plaidItems.householdId, scope.householdId)))
      .returning({ id: plaidItems.id });
    return rows.length > 0;
  });
}

// ---------- sync events ----------

export interface SyncEventValues {
  householdId: string | null;
  itemId: string | null;
  kind: string;
  payloadHash: string | null;
  status: string;
  errorCode?: string | null;
  detail?: unknown;
}

/**
 * Record a webhook or sync run. Returns false when the payload hash was already
 * recorded: the caller treats that as a replay and does nothing.
 */
export async function recordSyncEvent(db: Db, v: SyncEventValues): Promise<boolean> {
  const rows = await db
    .insert(syncEvents)
    .values({ ...v, detail: v.detail ?? null })
    .onConflictDoNothing({ target: syncEvents.payloadHash })
    .returning({ id: syncEvents.id });
  return rows.length > 0;
}

export async function listSyncEvents(db: Db, scope: HouseholdScope, limit = 50) {
  return db
    .select()
    .from(syncEvents)
    .where(eq(syncEvents.householdId, scope.householdId))
    .orderBy(asc(syncEvents.createdAt))
    .limit(limit);
}
