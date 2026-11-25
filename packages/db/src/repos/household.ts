// Households, people, income and contribution streams, spending profile, scenarios.
import { and, asc, eq } from "drizzle-orm";
import { assertOwned, type Db, type HouseholdScope, isUuid } from "../db";
import {
  contributionStreams,
  householdMembers,
  households,
  incomeStreams,
  people,
  scenarios,
  spendingProfiles,
} from "../schema";

type Insert<T extends { $inferInsert: unknown }> = Omit<
  T["$inferInsert"],
  "id" | "householdId" | "createdAt" | "updatedAt"
>;
type Patch<T extends { $inferInsert: unknown }> = Partial<Insert<T>>;

// ---------- households (bootstrap functions are unscoped by nature) ----------

export async function findHouseholdIdForUser(db: Db, userId: string): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const rows = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return rows[0]?.householdId ?? null;
}

/** Create a household owned by a new user, with an empty spending profile. Idempotent per user. */
export async function createHouseholdForUser(db: Db, userId: string, name: string): Promise<string> {
  if (!isUuid(userId)) throw new Error("user id must be a uuid");
  return db.transaction(async (tx) => {
    const existing = await findHouseholdIdForUser(tx as unknown as Db, userId);
    if (existing) return existing;
    const [h] = await tx.insert(households).values({ name }).returning({ id: households.id });
    if (!h) throw new Error("household insert failed");
    await tx.insert(householdMembers).values({ householdId: h.id, userId, role: "owner" });
    await tx.insert(spendingProfiles).values({ householdId: h.id });
    return h.id;
  });
}

export async function getHousehold(db: Db, scope: HouseholdScope) {
  const rows = await db.select().from(households).where(eq(households.id, scope.householdId)).limit(1);
  return rows[0] ?? null;
}

export async function markOnboarded(db: Db, scope: HouseholdScope) {
  await db.update(households).set({ onboardedAt: new Date() }).where(eq(households.id, scope.householdId));
}

export async function renameHousehold(db: Db, scope: HouseholdScope, name: string) {
  await db.update(households).set({ name }).where(eq(households.id, scope.householdId));
}

// ---------- people ----------

export async function listPeople(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(people)
    .where(eq(people.householdId, scope.householdId))
    .orderBy(asc(people.sort), asc(people.createdAt));
}

export async function createPerson(db: Db, scope: HouseholdScope, values: Insert<typeof people>) {
  const existing = await listPeople(db, scope);
  if (existing.length >= 2) throw new Error("a household has at most two people");
  const [row] = await db
    .insert(people)
    .values({ ...values, householdId: scope.householdId })
    .returning();
  return row!;
}

export async function updatePerson(db: Db, scope: HouseholdScope, id: string, patch: Patch<typeof people>) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(people)
    .set(patch)
    .where(and(eq(people.id, id), eq(people.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

export async function deletePerson(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(people)
    .where(and(eq(people.id, id), eq(people.householdId, scope.householdId)))
    .returning({ id: people.id });
  return rows.length > 0;
}

// ---------- income streams ----------

export async function listIncomeStreams(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(incomeStreams)
    .where(eq(incomeStreams.householdId, scope.householdId))
    .orderBy(asc(incomeStreams.createdAt));
}

export async function createIncomeStream(
  db: Db,
  scope: HouseholdScope,
  values: Insert<typeof incomeStreams>,
) {
  await assertOwned(db, scope, people, values.personId, "person");
  const [row] = await db
    .insert(incomeStreams)
    .values({ ...values, householdId: scope.householdId })
    .returning();
  return row!;
}

export async function updateIncomeStream(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Patch<typeof incomeStreams>,
) {
  if (!isUuid(id)) return null;
  if (patch.personId) await assertOwned(db, scope, people, patch.personId, "person");
  const [row] = await db
    .update(incomeStreams)
    .set(patch)
    .where(and(eq(incomeStreams.id, id), eq(incomeStreams.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

export async function deleteIncomeStream(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(incomeStreams)
    .where(and(eq(incomeStreams.id, id), eq(incomeStreams.householdId, scope.householdId)))
    .returning({ id: incomeStreams.id });
  return rows.length > 0;
}

// ---------- contribution streams ----------

export async function listContributionStreams(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(contributionStreams)
    .where(eq(contributionStreams.householdId, scope.householdId))
    .orderBy(asc(contributionStreams.createdAt));
}

export async function createContributionStream(
  db: Db,
  scope: HouseholdScope,
  values: Insert<typeof contributionStreams>,
) {
  const [row] = await db
    .insert(contributionStreams)
    .values({ ...values, householdId: scope.householdId })
    .returning();
  return row!;
}

export async function updateContributionStream(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Patch<typeof contributionStreams>,
) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(contributionStreams)
    .set(patch)
    .where(and(eq(contributionStreams.id, id), eq(contributionStreams.householdId, scope.householdId)))
    .returning();
  return row ?? null;
}

export async function deleteContributionStream(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(contributionStreams)
    .where(and(eq(contributionStreams.id, id), eq(contributionStreams.householdId, scope.householdId)))
    .returning({ id: contributionStreams.id });
  return rows.length > 0;
}

// ---------- spending profile ----------

export async function getSpendingProfile(db: Db, scope: HouseholdScope) {
  const rows = await db
    .select()
    .from(spendingProfiles)
    .where(eq(spendingProfiles.householdId, scope.householdId))
    .limit(1);
  return rows[0] ?? null;
}

export async function setSpendingProfile(
  db: Db,
  scope: HouseholdScope,
  values: Patch<typeof spendingProfiles>,
) {
  const [row] = await db
    .insert(spendingProfiles)
    .values({ ...values, householdId: scope.householdId })
    .onConflictDoUpdate({ target: spendingProfiles.householdId, set: values })
    .returning();
  return row!;
}

// ---------- scenarios ----------

export async function listScenarios(db: Db, scope: HouseholdScope) {
  return db
    .select()
    .from(scenarios)
    .where(eq(scenarios.householdId, scope.householdId))
    .orderBy(asc(scenarios.createdAt));
}

export async function getScenario(db: Db, scope: HouseholdScope, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.id, id), eq(scenarios.householdId, scope.householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBaselineScenario(db: Db, scope: HouseholdScope) {
  const rows = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.householdId, scope.householdId), eq(scenarios.isBaseline, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createScenario(db: Db, scope: HouseholdScope, values: Insert<typeof scenarios>) {
  return db.transaction(async (tx) => {
    if (values.isBaseline) {
      await tx
        .update(scenarios)
        .set({ isBaseline: false })
        .where(eq(scenarios.householdId, scope.householdId));
    }
    const [row] = await tx
      .insert(scenarios)
      .values({ ...values, householdId: scope.householdId })
      .returning();
    return row!;
  });
}

export async function updateScenario(
  db: Db,
  scope: HouseholdScope,
  id: string,
  patch: Patch<typeof scenarios>,
) {
  if (!isUuid(id)) return null;
  return db.transaction(async (tx) => {
    if (patch.isBaseline) {
      await tx
        .update(scenarios)
        .set({ isBaseline: false })
        .where(eq(scenarios.householdId, scope.householdId));
    }
    const [row] = await tx
      .update(scenarios)
      .set(patch)
      .where(and(eq(scenarios.id, id), eq(scenarios.householdId, scope.householdId)))
      .returning();
    return row ?? null;
  });
}

export async function deleteScenario(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(scenarios)
    .where(
      and(
        eq(scenarios.id, id),
        eq(scenarios.householdId, scope.householdId),
        eq(scenarios.isBaseline, false),
      ),
    )
    .returning({ id: scenarios.id });
  return rows.length > 0;
}
