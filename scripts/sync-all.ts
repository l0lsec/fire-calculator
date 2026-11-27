// Sync every healthy bank connection now: `pnpm sync`. Useful from a scheduler
// (launchd, cron) when running locally without Plaid webhooks.

import { importFromIphone } from "../apps/web/src/server/financekit";
import { plaidDeps } from "../apps/web/src/server/plaid/config";
import { cronJobs, runJob } from "../apps/web/src/server/plaid/jobs";
import { createClient } from "../packages/db/src/client";
import { scopeFor } from "../packages/db/src/db";
import { testHouseholdIds } from "../packages/db/src/repos/household";
import { financekitDevices } from "../packages/db/src/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = createClient(url, { max: 2 });
try {
  const deps = await plaidDeps();
  // End-to-end test households share the local database; their banks are fake.
  const tests = await testHouseholdIds(db);
  const jobs = (await cronJobs(db)).filter((j) => !tests.has(j.householdId));
  if (tests.size) console.log(`skipping ${tests.size} test household(s)`);
  for (const job of jobs) {
    const r = await runJob(db, deps, job);
    console.log(`${job.itemId}: ${r?.status ?? "skipped"} (+${r?.added ?? 0} transactions)`);
  }
  console.log(`SYNCED ${jobs.length} connection(s)`);
  // The iPhone companion app (Apple Card, Apple Cash, Savings via FinanceKit).
  for (const d of await db.select({ householdId: financekitDevices.householdId }).from(financekitDevices)) {
    if (tests.has(d.householdId)) continue;
    const r = await importFromIphone({ db, scope: scopeFor(d.householdId) });
    console.log(`iphone: ${r.status}${r.status === "imported" ? ` (${r.transactions} transactions)` : ""}`);
  }
} finally {
  await close();
}
