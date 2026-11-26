// Bills the user adds by hand so Safe to spend can count them before the bank history shows them.
import { and, asc, eq } from "drizzle-orm";
import { assertOwned, type Db, type HouseholdScope } from "../db";
import { accounts, scheduledBills } from "../schema";

export type ScheduledBillRow = typeof scheduledBills.$inferSelect;
export type NewScheduledBill = Pick<
  ScheduledBillRow,
  "accountId" | "name" | "amountCents" | "cadence" | "nextDate"
>;

export async function listScheduledBills(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(scheduledBills)
    .where(eq(scheduledBills.householdId, scope.householdId))
    .orderBy(asc(scheduledBills.nextDate), asc(scheduledBills.name));
}

/** Add a bill on one of this household's accounts (throws NotOwnedError for any other account). */
export async function addScheduledBill(db: Db, scope: HouseholdScope, bill: NewScheduledBill) {
  await assertOwned(db, scope, accounts, bill.accountId, "account");
  const [row] = await db
    .insert(scheduledBills)
    .values({ householdId: scope.householdId, ...bill })
    .returning();
  return row!;
}

/** Delete one bill; returns it (for Undo) or null when it was not this household's. */
export async function deleteScheduledBill(db: Db, scope: HouseholdScope, id: string) {
  const [row] = await db
    .delete(scheduledBills)
    .where(and(eq(scheduledBills.householdId, scope.householdId), eq(scheduledBills.id, id)))
    .returning();
  return row ?? null;
}
