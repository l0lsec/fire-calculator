// Accounts, balance snapshots, holdings and debts.
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { assertOwned, type Db, type HouseholdScope, isUuid } from "../db";
import { accounts, balanceSnapshots, debts, holdings, plaidItems } from "../schema";

type Insert<T extends { $inferInsert: unknown }> = Omit<
  T["$inferInsert"],
  "id" | "householdId" | "createdAt" | "updatedAt"
>;
type Patch<T extends { $inferInsert: unknown }> = Partial<Insert<T>>;
export type AccountRow = typeof accounts.$inferSelect;
export type DebtRow = typeof debts.$inferSelect;

// ---------- accounts ----------

export async function listAccounts(db: Db, scope: HouseholdScope, opts: { includeArchived?: boolean } = {}) {
  const where = opts.includeArchived
    ? eq(accounts.householdId, scope.householdId)
    : and(eq(accounts.householdId, scope.householdId), eq(accounts.archived, false));
  return db.select().from(accounts).where(where).orderBy(asc(accounts.createdAt));
}

export async function getAccount(db: Db, scope: HouseholdScope, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, scope.householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createManualAccount(
  db: Db,
  scope: HouseholdScope,
  values: Omit<Insert<typeof accounts>, "source" | "itemId" | "plaidAccountId">,
) {
  const [row] = await db
    .insert(accounts)
    .values({ ...values, source: "manual", householdId: scope.householdId })
    .returning();
  return row!;
}

/** User edits. Changing the bucket marks it overridden so syncs keep the user's choice. */
export async function updateAccount(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Pick<
    Patch<typeof accounts>,
    | "name"
    | "bucket"
    | "includeInFi"
    | "business"
    | "currentCents"
    | "costBasisCents"
    | "rothBasisCents"
    | "archived"
  >,
) {
  if (!isUuid(id)) return null;
  const set = patch.bucket !== undefined ? { ...patch, bucketOverridden: true } : patch;
  const [row] = await db
    .update(accounts)
    .set(set)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

export async function deleteManualAccount(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(accounts)
    .where(
      and(eq(accounts.id, id), eq(accounts.householdId, scope.householdId), eq(accounts.source, "manual")),
    )
    .returning({ id: accounts.id });
  return rows.length > 0;
}

export interface PlaidAccountValues {
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  bucket: AccountRow["bucket"];
  currentCents: number;
  availableCents: number | null;
  isoCurrency: string;
}

/** Insert or refresh a Plaid account. A user's bucket override survives. */
export async function upsertPlaidAccount(
  db: Db,
  scope: HouseholdScope,
  itemId: string,
  v: PlaidAccountValues,
) {
  await assertOwned(db, scope, plaidItems, itemId, "plaid item");
  const existing = await db
    .select()
    .from(accounts)
    .where(eq(accounts.plaidAccountId, v.plaidAccountId))
    .limit(1);
  const prior = existing[0];
  if (prior && prior.householdId !== scope.householdId) {
    throw new Error("plaid account already linked to another household");
  }
  if (prior) {
    const [row] = await db
      .update(accounts)
      .set({
        itemId,
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
      .where(eq(accounts.id, prior.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(accounts)
    .values({ ...v, source: "plaid", itemId, householdId: scope.householdId })
    .returning();
  return row!;
}

// ---------- balance snapshots ----------

export async function recordSnapshot(
  db: Db,
  scope: HouseholdScope,
  accountId: string,
  asOfDate: string,
  currentCents: number,
) {
  await assertOwned(db, scope, accounts, accountId, "account");
  await db
    .insert(balanceSnapshots)
    .values({ householdId: scope.householdId, accountId, asOfDate, currentCents })
    .onConflictDoUpdate({
      target: [balanceSnapshots.accountId, balanceSnapshots.asOfDate],
      set: { currentCents },
    });
}

export async function listSnapshots(db: Db, scope: HouseholdScope, from: string, to: string) {
  return db
    .select()
    .from(balanceSnapshots)
    .where(
      and(
        eq(balanceSnapshots.householdId, scope.householdId),
        gte(balanceSnapshots.asOfDate, from),
        lte(balanceSnapshots.asOfDate, to),
      ),
    )
    .orderBy(asc(balanceSnapshots.asOfDate));
}

// ---------- holdings ----------

export interface HoldingValues {
  securityId: string;
  ticker: string | null;
  name: string | null;
  securityType: string | null;
  quantity: number;
  valueCents: number;
  costBasisCents: number | null;
}

/** Replace an account's holdings with the latest set. */
export async function replaceHoldings(
  db: Db,
  scope: HouseholdScope,
  accountId: string,
  rows: HoldingValues[],
) {
  await assertOwned(db, scope, accounts, accountId, "account");
  await db.transaction(async (tx) => {
    await tx
      .delete(holdings)
      .where(and(eq(holdings.accountId, accountId), eq(holdings.householdId, scope.householdId)));
    if (rows.length) {
      await tx
        .insert(holdings)
        .values(rows.map((r) => ({ ...r, accountId, householdId: scope.householdId })));
    }
  });
}

export async function listHoldings(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(holdings)
    .where(eq(holdings.householdId, scope.householdId))
    .orderBy(desc(holdings.valueCents));
}

// ---------- debts ----------

/** Fields whose provenance is tracked: a user edit pins the field against syncs. */
export const TRACKED_DEBT_FIELDS = [
  "name",
  "kind",
  "balanceCents",
  "apr",
  "minPaymentRule",
  "promoApr",
  "promoEndsMonth",
  "maturityDate",
  "escrowMonthlyCents",
] as const;
type TrackedField = (typeof TRACKED_DEBT_FIELDS)[number];
type Provenance = Partial<Record<TrackedField, "plaid" | "user">>;

export async function listDebts(db: Db, scope: HouseholdScope, opts: { includeArchived?: boolean } = {}) {
  const where = opts.includeArchived
    ? eq(debts.householdId, scope.householdId)
    : and(eq(debts.householdId, scope.householdId), eq(debts.archived, false));
  return db.select().from(debts).where(where).orderBy(asc(debts.createdAt));
}

export async function getDebt(db: Db, scope: HouseholdScope, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(debts)
    .where(and(eq(debts.id, id), eq(debts.householdId, scope.householdId)))
    .limit(1);
  return rows[0] ?? null;
}

function userProvenance(keys: string[], prior: Provenance = {}): Provenance {
  const out: Provenance = { ...prior };
  for (const k of keys)
    if ((TRACKED_DEBT_FIELDS as readonly string[]).includes(k)) out[k as TrackedField] = "user";
  return out;
}

export async function createDebt(
  db: Db,
  scope: HouseholdScope,
  values: Omit<Insert<typeof debts>, "fieldProvenance" | "aprSource">,
) {
  if (values.accountId) await assertOwned(db, scope, accounts, values.accountId, "account");
  const [row] = await db
    .insert(debts)
    .values({
      ...values,
      householdId: scope.householdId,
      aprSource: values.apr === null || values.apr === undefined ? "unknown" : "user",
      fieldProvenance: userProvenance(Object.keys(values)),
    })
    .returning();
  return row!;
}

export async function updateDebt(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Omit<Patch<typeof debts>, "fieldProvenance" | "aprSource" | "accountId">,
) {
  const prior = await getDebt(db, scope, id);
  if (!prior) return null;
  const provenance = userProvenance(Object.keys(patch), prior.fieldProvenance as Provenance);
  const aprSource = "apr" in patch ? (patch.apr === null ? "unknown" : "user") : prior.aprSource;
  const [row] = await db
    .update(debts)
    .set({ ...patch, fieldProvenance: provenance, aprSource })
    .where(and(eq(debts.id, id), eq(debts.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

export async function deleteDebt(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(debts)
    .where(and(eq(debts.id, id), eq(debts.householdId, scope.householdId)))
    .returning({ id: debts.id });
  return rows.length > 0;
}

export type PlaidDebtFields = Partial<Pick<Insert<typeof debts>, TrackedField>> & {
  name: string;
  kind: DebtRow["kind"];
  balanceCents: number;
};

/**
 * Create or refresh the debt linked to a Plaid account. Fields the user has
 * edited ("user" provenance) are left alone; every field written is "plaid".
 */
export async function upsertDebtFromPlaid(
  db: Db,
  scope: HouseholdScope,
  accountId: string,
  fields: PlaidDebtFields,
) {
  await assertOwned(db, scope, accounts, accountId, "account");
  const rows = await db
    .select()
    .from(debts)
    .where(and(eq(debts.accountId, accountId), eq(debts.householdId, scope.householdId)))
    .limit(1);
  const prior = rows[0];
  const provenance: Provenance = { ...((prior?.fieldProvenance as Provenance | undefined) ?? {}) };
  const set: Record<string, unknown> = {};
  for (const key of TRACKED_DEBT_FIELDS) {
    if (!(key in fields)) continue;
    if (provenance[key] === "user") continue;
    set[key] = fields[key];
    provenance[key] = "plaid";
  }
  if ("apr" in set) set.aprSource = set.apr === null || set.apr === undefined ? "unknown" : "plaid";
  if (prior) {
    const [row] = await db
      .update(debts)
      .set({ ...set, fieldProvenance: provenance, archived: false })
      .where(eq(debts.id, prior.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(debts)
    .values({
      name: fields.name,
      kind: fields.kind,
      balanceCents: fields.balanceCents,
      minPaymentRule: fields.minPaymentRule ?? { type: "fixed", amount: 0 },
      ...set,
      aprSource: (set.aprSource as DebtRow["aprSource"] | undefined) ?? "unknown",
      accountId,
      householdId: scope.householdId,
      fieldProvenance: provenance,
    })
    .returning();
  return row!;
}

/** Archive debts whose linked accounts are among `accountIds` (used when an Item is removed). */
export async function archiveDebtsForAccounts(db: Db, scope: HouseholdScope, accountIds: string[]) {
  if (accountIds.length === 0) return;
  await db
    .update(debts)
    .set({ archived: true })
    .where(and(eq(debts.householdId, scope.householdId), inArray(debts.accountId, accountIds)));
}
