// Subscriptions and bills, budgets, and alerts: one loader shared by the
// pages and the Mac notifier (scripts/notify.ts).
import {
  addScheduledBill,
  type Db,
  deleteScheduledBill,
  dismissAlerts,
  getAlertSettings,
  type HouseholdScope,
  listAccounts,
  listAlertState,
  listBudgets,
  listScheduledBills,
  restoreAlerts,
  setAlertSettings,
  setBudget,
} from "@fire/db";
import {
  type Alert,
  budgetReport,
  buildAlerts,
  type Cadence,
  categoryName,
  detectRecurring,
  forecastCash,
  monthlyAverages,
  nextDue,
  type RecurringSeries,
} from "@fire/spending";
import { z } from "zod";
import { type ActionResult, checkbox, dollars, parseForm } from "../forms";
import { deriveHouseholdSpending, todayISO } from "../snapshot";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const HIDE_PREFIX = "hide-recurring:";

/** First day of the month after `asOf`: spending windows ending there include this month. */
export function nextMonthStart(asOf: string): string {
  const y = +asOf.slice(0, 4);
  const m = +asOf.slice(5, 7);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export { categoryName };

export async function loadInsights(ctx: Ctx, asOf: string = todayISO()) {
  const [current, history, accounts, budgetRows, state, settings, billRows] = await Promise.all([
    deriveHouseholdSpending(ctx, nextMonthStart(asOf)),
    deriveHouseholdSpending(ctx, asOf),
    listAccounts(ctx.db, ctx.scope),
    listBudgets(ctx.db, ctx.scope),
    listAlertState(ctx.db, ctx.scope),
    getAlertSettings(ctx.db, ctx.scope),
    listScheduledBills(ctx.db, ctx.scope),
  ]);
  const scheduled = billRows.map((b) => ({
    id: b.id,
    accountId: b.accountId,
    name: b.name,
    amountCents: b.amountCents,
    cadence: b.cadence as Cadence,
    nextDate: b.nextDate,
  }));
  const dismissed = new Set(state.filter((s) => s.dismissedAt).map((s) => s.key));
  const notified = new Set(state.filter((s) => s.notifiedAt).map((s) => s.key));

  const all = detectRecurring(current.classified, asOf);
  const hidden = all.filter((s) => dismissed.has(HIDE_PREFIX + s.key));
  const visible = all.filter((s) => !dismissed.has(HIDE_PREFIX + s.key));
  const active = visible.filter((s) => s.active);

  const averages = monthlyAverages(history);
  const budgets = budgetReport({
    classified: current.classified,
    asOf,
    budgets: budgetRows.map((b) => ({ category: b.category, monthlyCents: b.monthlyCents })),
    averages,
  });

  // Safe to spend: the next 30 days of each cash account, with the low-balance level as the cushion.
  const cash = forecastCash({
    asOf,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      business: a.business,
      balanceCents: a.availableCents ?? a.currentCents,
    })),
    classified: current.classified,
    pending: current.pending,
    cushionCents: settings.lowBalanceCents,
    hiddenMerchants: new Set(hidden.map((h) => h.key.split("|")[0] as string)),
    scheduled,
  });

  const alertsAll = buildAlerts({
    asOf,
    cash,
    recurring: visible,
    budgets,
    classified: current.classified,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      currentCents: a.currentCents,
      availableCents: a.availableCents,
    })),
    settings,
  });

  // Living spending in the last 7 days against the 7 before, for the weekly summary.
  const t = (d: string) => new Date(`${d}T00:00:00Z`).getTime() / 86_400_000;
  const today = t(asOf);
  let last7 = 0;
  let prev7 = 0;
  for (const c of current.classified) {
    if (c.tx.pending || (c.class !== "living_expense" && c.class !== "refund")) continue;
    const age = today - t(c.tx.date);
    if (age >= 0 && age < 7) last7 += c.tx.amountCents;
    else if (age >= 7 && age < 14) prev7 += c.tx.amountCents;
  }

  const sum = (xs: RecurringSeries[]) => xs.reduce((s, x) => s + x.monthlyCents, 0);
  const subscriptions = active.filter((s) => s.kind === "subscription");
  const bills = active.filter((s) => s.kind === "bill");
  const lead = new Date(`${asOf}T00:00:00Z`).getTime() + 14 * 86_400_000;
  return {
    asOf,
    recurring: {
      subscriptions,
      bills,
      inactive: visible.filter((s) => !s.active),
      hidden,
      upcoming: active
        .filter((s) => s.nextDate >= asOf && new Date(`${s.nextDate}T00:00:00Z`).getTime() <= lead)
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
      subscriptionMonthlyCents: sum(subscriptions),
      billMonthlyCents: sum(bills),
    },
    budgets,
    cash,
    /** Bills added by hand, soonest first, with the next date each is due. */
    scheduledBills: scheduled
      .map((b) => ({ ...b, dueDate: nextDue(b, asOf) }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name)),
    week: { spentCents: last7, previousCents: prev7 },
    alerts: alertsAll.filter((a) => !dismissed.has(a.key)),
    unnotified: (alerts: Alert[]) => alerts.filter((a) => !notified.has(a.key)),
    settings,
    connected: accounts.some((a) => a.source !== "manual"),
  };
}

export type Insights = Awaited<ReturnType<typeof loadInsights>>;

// ---------- actions ----------

const CATEGORY = z.string().regex(/^[A-Z_]{3,60}$/, "Unknown category");

const BudgetForm = z.object({ category: CATEGORY, amount: dollars({ optional: true, max: 10_000_000 }) });

export async function saveBudget(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = parseForm(BudgetForm, input);
  if ("result" in parsed) return parsed.result;
  await setBudget(ctx.db, ctx.scope, parsed.data.category, parsed.data.amount);
  return { ok: true };
}

/** Set every unbudgeted category with spending to its typical month, rounded up to $10. */
export async function suggestBudgets(
  ctx: Ctx,
  asOf: string = todayISO(),
): Promise<ActionResult<{ set: number }>> {
  const insights = await loadInsights(ctx, asOf);
  let set = 0;
  for (const line of insights.budgets) {
    if (line.budgetCents !== null || line.averageCents < 1000) continue;
    await setBudget(ctx.db, ctx.scope, line.category, Math.ceil(line.averageCents / 1000) * 1000);
    set++;
  }
  return { ok: true, data: { set } };
}

const KEY = z.string().min(3).max(300);

export async function dismissAlert(
  ctx: Ctx,
  key: string,
): Promise<ActionResult<{ message: string; undo: Record<string, string> }>> {
  if (!KEY.safeParse(key).success) return { ok: false, error: "That alert is gone; reload the page." };
  await dismissAlerts(ctx.db, ctx.scope, [key]);
  return { ok: true, data: { message: "Alert dismissed.", undo: { key } } };
}

/** Bring back a dismissed alert (Undo). */
export async function restoreAlert(ctx: Ctx, key: string): Promise<ActionResult> {
  if (!KEY.safeParse(key).success) return { ok: false, error: "Could not undo that." };
  await restoreAlerts(ctx.db, ctx.scope, [key]);
  return { ok: true };
}

export async function hideRecurring(
  ctx: Ctx,
  seriesKey: string,
  hide: boolean,
): Promise<ActionResult<{ message: string; undo: Record<string, string> }>> {
  if (!KEY.safeParse(seriesKey).success) return { ok: false, error: "That charge is gone; reload the page." };
  if (hide) await dismissAlerts(ctx.db, ctx.scope, [HIDE_PREFIX + seriesKey]);
  else await restoreAlerts(ctx.db, ctx.scope, [HIDE_PREFIX + seriesKey]);
  return {
    ok: true,
    data: {
      message: hide ? "Marked not recurring." : "Back in your recurring charges.",
      undo: { key: seriesKey, hide: hide ? "false" : "true" },
    },
  };
}

const SettingsForm = z.object({
  largeCharge: dollars({ min: 1, max: 1_000_000 }),
  lowBalance: dollars({ min: 0, max: 1_000_000 }),
  billLeadDays: z.coerce.number().int().min(0, "0 to 30 days").max(30, "0 to 30 days"),
  macNotifications: checkbox,
  weeklySummary: checkbox,
});

export async function saveAlertSettings(ctx: Ctx, input: Record<string, string>): Promise<ActionResult> {
  const parsed = parseForm(SettingsForm, input);
  if ("result" in parsed) return parsed.result;
  const v = parsed.data;
  await setAlertSettings(ctx.db, ctx.scope, {
    largeChargeCents: v.largeCharge as number,
    lowBalanceCents: v.lowBalance as number,
    billLeadDays: v.billLeadDays,
    macNotifications: v.macNotifications,
    weeklySummary: v.weeklySummary,
  });
  return { ok: true };
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const CushionForm = z.object({ cushion: dollars({ min: 0, max: 1_000_000 }) });

/** The cushion Safe to spend keeps back; it is also the low-balance alert level. */
export async function saveCushion(
  ctx: Ctx,
  input: Record<string, string>,
): Promise<ActionResult<{ message: string }>> {
  const parsed = parseForm(CushionForm, input);
  if ("result" in parsed) return parsed.result as ActionResult<{ message: string }>;
  const cents = parsed.data.cushion as number;
  await setAlertSettings(ctx.db, ctx.scope, { lowBalanceCents: cents });
  const { cash } = await loadInsights(ctx);
  const safe = cash.spendable?.safeToSpendCents ?? 0;
  return {
    ok: true,
    data: { message: `Cushion set to ${usd(cents)}. Safe to spend is now ${usd(safe)}.` },
  };
}

// ---------- bills added by hand ----------

export const CADENCES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;

const BillForm = z.object({
  name: z.string().trim().min(1, "Name the bill").max(80, "Keep it under 80 characters"),
  amount: dollars({ min: 1, max: 1_000_000 }),
  cadence: z.enum(CADENCES, { message: "Choose how often it comes out" }),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the next date it comes out"),
  accountId: z.string().uuid("Choose the account it comes out of"),
});

/** Add a bill Safe to spend should count; says what Safe to spend is now. */
export async function addBill(
  ctx: Ctx,
  input: Record<string, string>,
): Promise<ActionResult<{ message: string }>> {
  const parsed = parseForm(BillForm, input);
  if ("result" in parsed) return parsed.result as ActionResult<{ message: string }>;
  const v = parsed.data;
  const account = (await listAccounts(ctx.db, ctx.scope)).find((a) => a.id === v.accountId);
  if (!account || account.type !== "depository")
    return { ok: false, fieldErrors: { accountId: "Choose a checking or savings account" } };
  await addScheduledBill(ctx.db, ctx.scope, {
    accountId: v.accountId,
    name: v.name,
    amountCents: v.amount as number,
    cadence: v.cadence,
    nextDate: v.nextDate,
  });
  const { cash } = await loadInsights(ctx);
  return {
    ok: true,
    data: { message: `Added ${v.name}. Safe to spend is now ${usd(cash.spendable?.safeToSpendCents ?? 0)}.` },
  };
}

/** Delete a bill added by hand; Undo adds it back with the same details. */
export async function removeBill(
  ctx: Ctx,
  id: string,
): Promise<ActionResult<{ message: string; undo: Record<string, string> }>> {
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "That bill is gone; reload the page." };
  const row = await deleteScheduledBill(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "That bill is gone; reload the page." };
  return {
    ok: true,
    data: {
      message: `Removed ${row.name}.`,
      undo: {
        name: row.name,
        amount: (row.amountCents / 100).toFixed(2),
        cadence: row.cadence,
        nextDate: row.nextDate,
        accountId: row.accountId,
      },
    },
  };
}
