// The paired iPhone companion (FinanceKit) and the accounts it reports.
import { and, eq } from "drizzle-orm";
import type { Db, HouseholdScope } from "../db";
import { accounts, financekitDevices } from "../schema";
import type { AccountRow, PlaidAccountValues } from "./accounts";

export type FinancekitDeviceRow = typeof financekitDevices.$inferSelect;

export async function getFinancekitDevice(db: Db, scope: HouseholdScope) {
  const rows = await db
    .select()
    .from(financekitDevices)
    .where(eq(financekitDevices.householdId, scope.householdId))
    .limit(1);
  return rows[0] ?? null;
}

/** Store a new pairing, replacing any earlier one (its files are then ignored). */
export async function saveFinancekitPairing(
  db: Db,
  scope: HouseholdScope,
  v: { pairingId: string; keyCiphertext: string; keyIv: string; keyVersion: number },
) {
  const [row] = await db
    .insert(financekitDevices)
    .values({ ...v, householdId: scope.householdId })
    .onConflictDoUpdate({
      target: financekitDevices.householdId,
      set: {
        ...v,
        deviceName: null,
        lastSnapshotAt: null,
        lastImportAt: null,
        lastError: null,
        createdAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function updateFinancekitDevice(
  db: Db,
  scope: HouseholdScope,
  patch: Partial<Pick<FinancekitDeviceRow, "deviceName" | "lastSnapshotAt" | "lastImportAt" | "lastError">>,
) {
  await db.update(financekitDevices).set(patch).where(eq(financekitDevices.householdId, scope.householdId));
}

export async function deleteFinancekitDevice(db: Db, scope: HouseholdScope): Promise<boolean> {
  const rows = await db
    .delete(financekitDevices)
    .where(eq(financekitDevices.householdId, scope.householdId))
    .returning({ id: financekitDevices.id });
  return rows.length > 0;
}

/**
 * Insert or refresh an account reported by the companion app. Its external id
 * (prefixed "fk:") lives in the same unique column as Plaid account ids, so the
 * two sources can never collide. A user's bucket override survives.
 */
export async function upsertFinancekitAccount(
  db: Db,
  scope: HouseholdScope,
  v: PlaidAccountValues,
): Promise<AccountRow> {
  if (!v.plaidAccountId.startsWith("fk:")) throw new Error("FinanceKit account ids must start with fk:");
  const existing = await db
    .select()
    .from(accounts)
    .where(eq(accounts.plaidAccountId, v.plaidAccountId))
    .limit(1);
  const prior = existing[0];
  if (prior && prior.householdId !== scope.householdId) {
    throw new Error("account already linked to another household");
  }
  if (prior) {
    const [row] = await db
      .update(accounts)
      .set({
        name: v.name,
        officialName: v.officialName,
        mask: v.mask,
        type: v.type,
        subtype: v.subtype,
        currentCents: v.currentCents,
        availableCents: v.availableCents,
        isoCurrency: v.isoCurrency,
        archived: false,
        ...(prior.bucketOverridden ? {} : { bucket: v.bucket }),
      })
      .where(and(eq(accounts.id, prior.id), eq(accounts.householdId, scope.householdId)))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(accounts)
    .values({ ...v, source: "financekit", itemId: null, householdId: scope.householdId })
    .returning();
  return row!;
}

/** Archive every companion-app account (used when the iPhone is unpaired). */
export async function archiveFinancekitAccounts(db: Db, scope: HouseholdScope): Promise<string[]> {
  const rows = await db
    .update(accounts)
    .set({ archived: true })
    .where(and(eq(accounts.householdId, scope.householdId), eq(accounts.source, "financekit")))
    .returning({ id: accounts.id });
  return rows.map((r) => r.id);
}
