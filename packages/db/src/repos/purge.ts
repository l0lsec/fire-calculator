// "Delete everything": removes every row a household owns and leaves a
// tombstone with no personal data, only the id, a reason and a row count.
import { count, eq } from "drizzle-orm";
import type { Db, HouseholdScope } from "../db";
import { auditTombstones, HOUSEHOLD_TABLES, households } from "../schema";

export async function countHouseholdRows(db: Db, scope: HouseholdScope): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(HOUSEHOLD_TABLES)) {
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.householdId, scope.householdId));
    out[name] = row?.n ?? 0;
  }
  const [h] = await db.select({ n: count() }).from(households).where(eq(households.id, scope.householdId));
  out.households = h?.n ?? 0;
  return out;
}

export async function purgeHousehold(db: Db, scope: HouseholdScope, reason: string): Promise<number> {
  return db.transaction(async (tx) => {
    const counts = await countHouseholdRows(tx as unknown as Db, scope);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // Every household table cascades from households.
    await tx.delete(households).where(eq(households.id, scope.householdId));
    await tx.insert(auditTombstones).values({ householdId: scope.householdId, reason, rowsDeleted: total });
    return total;
  });
}
