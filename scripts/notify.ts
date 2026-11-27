// Mac notifications for new alerts, plus a weekly summary: `pnpm notify`.
// Run it after `pnpm sync` (the daily schedule in scripts/schedule.mjs does
// both). Each alert is announced once; the weekly summary goes out on Sundays
// (or the first run after one was missed). `--dry-run` prints instead.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { categoryName, loadInsights } from "../apps/web/src/server/insights";
import { todayISO } from "../apps/web/src/server/today";
import { createClient } from "../packages/db/src/client";
import { scopeFor } from "../packages/db/src/db";
import { testHouseholdIds } from "../packages/db/src/repos/household";
import { markAlertsNotified, setAlertSettings } from "../packages/db/src/repos/insights";
import { households } from "../packages/db/src/schema";
import { expectedCents } from "../packages/spending/src";

const run = promisify(execFile);
const dryRun = process.argv.includes("--dry-run");
const MAX_INDIVIDUAL = 4;

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** AppleScript string literal. */
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function notify(title: string, body: string) {
  if (dryRun || process.platform !== "darwin") {
    console.log(`[notification] ${title}: ${body}`);
    return;
  }
  await run("osascript", [
    "-e",
    `display notification ${q(body)} with title "FIRE Planner" subtitle ${q(title)}`,
  ]);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = createClient(url, { max: 2 });
try {
  const asOf = todayISO();
  const sunday = new Date(`${asOf}T12:00:00Z`).getUTCDay() === 0;
  // End-to-end test households share the local database: never notify about them.
  const tests = await testHouseholdIds(db);
  for (const h of await db.select({ id: households.id }).from(households)) {
    if (tests.has(h.id)) continue;
    const scope = scopeFor(h.id);
    const ctx = { db, scope };
    const insights = await loadInsights(ctx, asOf);
    const { settings } = insights;

    if (settings.macNotifications) {
      const fresh = insights.unnotified(insights.alerts);
      for (const a of fresh.slice(0, MAX_INDIVIDUAL)) await notify(a.title, a.detail);
      if (fresh.length > MAX_INDIVIDUAL) {
        await notify(
          `${fresh.length - MAX_INDIVIDUAL} more alerts`,
          "Open FIRE Planner > Alerts to see them.",
        );
      }
      if (!dryRun)
        await markAlertsNotified(
          db,
          scope,
          fresh.map((a) => a.key),
        );
      console.log(`alerts: ${fresh.length} new`);
    }

    const lastSummary = settings.lastWeeklySummaryAt?.getTime() ?? 0;
    const due = Date.now() - lastSummary > 6.5 * 86_400_000;
    if (settings.weeklySummary && due && (sunday || Date.now() - lastSummary > 8 * 86_400_000)) {
      const w = insights.week;
      const change =
        w.previousCents > 0 ? Math.round(((w.spentCents - w.previousCents) / w.previousCents) * 100) : null;
      const over = insights.budgets.filter((b) => b.status === "over");
      const soon = insights.recurring.upcoming.filter((s) => s.nextDate <= addDays(asOf, 7));
      const parts = [
        `Spent ${usd(w.spentCents)} this week${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change}% vs last week)`}.`,
        over.length
          ? `Over budget: ${over.map((b) => categoryName(b.category)).join(", ")}.`
          : "All budgets on track.",
        soon.length
          ? `${soon.length} bills due this week, about ${usd(soon.reduce((s, x) => s + expectedCents(x), 0))}.`
          : "",
      ].filter(Boolean);
      await notify("Your week", parts.join(" "));
      if (!dryRun) await setAlertSettings(db, scope, { lastWeeklySummaryAt: new Date() });
      console.log("weekly summary sent");
    }
  }
  console.log("NOTIFY_DONE");
} finally {
  await close();
}

function addDays(d: string, n: number): string {
  return new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}
