// Transactions, user overrides and category rules.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { assertOwned, type Db, type HouseholdScope, isUuid, NotOwnedError } from "../db";
import { accounts, categoryRules, transactionOverrides, transactions } from "../schema";

export type TransactionRow = typeof transactions.$inferSelect;
export type TxClass = NonNullable<(typeof transactionOverrides.$inferSelect)["class"]>;

export interface TransactionValues {
  plaidTransactionId: string;
  accountId: string;
  postedDate: string;
  authorizedDate: string | null;
  amountCents: number;
  name: string;
  merchant: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pending: boolean;
  isoCurrency: string;
}

/** Idempotent upsert by Plaid transaction id. Every account must belong to the household. */
export async function upsertTransactions(db: Db, scope: HouseholdScope, rows: TransactionValues[]) {
  if (rows.length === 0) return 0;
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const owned = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, scope.householdId), inArray(accounts.id, accountIds)));
  if (owned.length !== accountIds.length) throw new NotOwnedError("account");
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await db
      .insert(transactions)
      .values(chunk.map((r) => ({ ...r, householdId: scope.householdId })))
      .onConflictDoUpdate({
        target: transactions.plaidTransactionId,
        set: {
          postedDate: sqlExcluded("posted_date"),
          authorizedDate: sqlExcluded("authorized_date"),
          amountCents: sqlExcluded("amount_cents"),
          name: sqlExcluded("name"),
          merchant: sqlExcluded("merchant"),
          pfcPrimary: sqlExcluded("pfc_primary"),
          pfcDetailed: sqlExcluded("pfc_detailed"),
          pending: sqlExcluded("pending"),
          accountId: sqlExcluded("account_id"),
        },
        // Never let an upsert move a row across households.
        setWhere: eqHousehold(scope.householdId),
      });
    n += chunk.length;
  }
  return n;
}

import { sql } from "drizzle-orm";

function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
function eqHousehold(householdId: string) {
  return sql`${transactions.householdId} = ${householdId}`;
}

export async function removeTransactions(db: Db, scope: HouseholdScope, plaidTransactionIds: string[]) {
  if (plaidTransactionIds.length === 0) return 0;
  const rows = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.householdId, scope.householdId),
        inArray(transactions.plaidTransactionId, plaidTransactionIds),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

export async function listTransactions(db: Db, scope: HouseholdScope, from: string, to: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, scope.householdId),
        gte(transactions.postedDate, from),
        lte(transactions.postedDate, to),
      ),
    )
    .orderBy(asc(transactions.postedDate), asc(transactions.plaidTransactionId));
}

export async function getTransaction(db: Db, scope: HouseholdScope, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, scope.householdId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Record matched transfer pairs (both legs share a pair id); clears stale pairs first. */
export async function setTransferPairs(db: Db, scope: HouseholdScope, pairs: [string, string][]) {
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ transferPairId: null })
      .where(eq(transactions.householdId, scope.householdId));
    for (const [a, b] of pairs) {
      const pairId = crypto.randomUUID();
      await tx
        .update(transactions)
        .set({ transferPairId: pairId })
        .where(and(eq(transactions.householdId, scope.householdId), inArray(transactions.id, [a, b])));
    }
  });
}

// ---------- overrides ----------

export interface OverrideValues {
  class?: TxClass | null;
  essential?: boolean | null;
  oneTime?: boolean;
  amortizeYears?: number | null;
}

export async function setOverride(db: Db, scope: HouseholdScope, transactionId: string, v: OverrideValues) {
  await assertOwned(db, scope, transactions, transactionId, "transaction");
  const [row] = await db
    .insert(transactionOverrides)
    .values({ transactionId, householdId: scope.householdId, ...v })
    .onConflictDoUpdate({ target: transactionOverrides.transactionId, set: v })
    .returning();
  return row!;
}

export async function clearOverride(db: Db, scope: HouseholdScope, transactionId: string): Promise<boolean> {
  if (!isUuid(transactionId)) return false;
  const rows = await db
    .delete(transactionOverrides)
    .where(
      and(
        eq(transactionOverrides.transactionId, transactionId),
        eq(transactionOverrides.householdId, scope.householdId),
      ),
    )
    .returning({ id: transactionOverrides.transactionId });
  return rows.length > 0;
}

export async function listOverrides(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(transactionOverrides)
    .where(eq(transactionOverrides.householdId, scope.householdId));
}

// ---------- category rules ----------

export async function listCategoryRules(db: Db, scope: HouseholdScope) {
  return db.select().from(categoryRules).where(eq(categoryRules.householdId, scope.householdId));
}

export async function setCategoryRule(
  db: Db,
  scope: HouseholdScope,
  pfcDetailed: string,
  v: { class: TxClass; essential: boolean },
) {
  const [row] = await db
    .insert(categoryRules)
    .values({ householdId: scope.householdId, pfcDetailed, ...v })
    .onConflictDoUpdate({ target: [categoryRules.householdId, categoryRules.pfcDetailed], set: v })
    .returning();
  return row!;
}

export async function deleteCategoryRule(
  db: Db,
  scope: HouseholdScope,
  pfcDetailed: string,
): Promise<boolean> {
  const rows = await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.householdId, scope.householdId), eq(categoryRules.pfcDetailed, pfcDetailed)))
    .returning({ id: categoryRules.id });
  return rows.length > 0;
}
