// Budgets, alert state (dismissed / notified) and alert settings.
import { and, eq, inArray } from "drizzle-orm";
import type { Db, HouseholdScope } from "../db";
import { alertSettings, alertState, budgets } from "../schema";

export type BudgetRow = typeof budgets.$inferSelect;
export type AlertStateRow = typeof alertState.$inferSelect;
export type AlertSettingsRow = typeof alertSettings.$inferSelect;

// ---------- budgets ----------

export async function listBudgets(db: Db, scope: HouseholdScope) {
  return db.select().from(budgets).where(eq(budgets.householdId, scope.householdId));
}

/** Set a category's monthly budget; null or zero removes it. */
export async function setBudget(
  db: Db,
  scope: HouseholdScope,
  category: string,
  monthlyCents: number | null,
) {
  if (monthlyCents === null || monthlyCents <= 0) {
    await db
      .delete(budgets)
      .where(and(eq(budgets.householdId, scope.householdId), eq(budgets.category, category)));
    return null;
  }
  const [row] = await db
    .insert(budgets)
    .values({ householdId: scope.householdId, category, monthlyCents })
    .onConflictDoUpdate({ target: [budgets.householdId, budgets.category], set: { monthlyCents } })
    .returning();
  return row!;
}

// ---------- alert state ----------

export async function listAlertState(db: Db, scope: HouseholdScope) {
  return db.select().from(alertState).where(eq(alertState.householdId, scope.householdId));
}

async function upsertState(
  db: Db,
  scope: HouseholdScope,
  keys: string[],
  set: Partial<Pick<AlertStateRow, "dismissedAt" | "notifiedAt">>,
) {
  if (keys.length === 0) return;
  await db
    .insert(alertState)
    .values(keys.map((key) => ({ householdId: scope.householdId, key, ...set })))
    .onConflictDoUpdate({ target: [alertState.householdId, alertState.key], set });
}

export async function dismissAlerts(db: Db, scope: HouseholdScope, keys: string[]) {
  await upsertState(db, scope, keys, { dismissedAt: new Date() });
}

export async function markAlertsNotified(db: Db, scope: HouseholdScope, keys: string[]) {
  await upsertState(db, scope, keys, { notifiedAt: new Date() });
}

/** Undo a dismissal (e.g. show a hidden recurring series again). */
export async function restoreAlerts(db: Db, scope: HouseholdScope, keys: string[]) {
  if (keys.length === 0) return;
  await db
    .update(alertState)
    .set({ dismissedAt: null })
    .where(and(eq(alertState.householdId, scope.householdId), inArray(alertState.key, keys)));
}

// ---------- settings ----------

export const DEFAULT_ALERT_SETTINGS = {
  largeChargeCents: 50_000,
  lowBalanceCents: 50_000,
  billLeadDays: 5,
  macNotifications: true,
  weeklySummary: true,
  overdraftFeeCents: null as number | null,
  lastWeeklySummaryAt: null as Date | null,
};

export async function getAlertSettings(db: Db, scope: HouseholdScope) {
  const rows = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.householdId, scope.householdId))
    .limit(1);
  return rows[0] ?? { householdId: scope.householdId, ...DEFAULT_ALERT_SETTINGS };
}

export async function setAlertSettings(
  db: Db,
  scope: HouseholdScope,
  patch: Partial<
    Pick<
      AlertSettingsRow,
      | "largeChargeCents"
      | "lowBalanceCents"
      | "billLeadDays"
      | "macNotifications"
      | "weeklySummary"
      | "overdraftFeeCents"
      | "lastWeeklySummaryAt"
    >
  >,
) {
  const [row] = await db
    .insert(alertSettings)
    .values({ householdId: scope.householdId, ...patch })
    .onConflictDoUpdate({ target: alertSettings.householdId, set: patch })
    .returning();
  return row!;
}
