// Sync every healthy bank connection now: `pnpm sync`. Useful from a scheduler
// (launchd, cron) when running locally without Plaid webhooks.

import { plaidDeps } from "../apps/web/src/server/plaid/config";
import { cronJobs, runJob } from "../apps/web/src/server/plaid/jobs";
import { createClient } from "../packages/db/src/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = createClient(url, { max: 2 });
try {
  const deps = await plaidDeps();
  const jobs = await cronJobs(db);
  for (const job of jobs) {
    const r = await runJob(db, deps, job);
    console.log(`${job.itemId}: ${r?.status ?? "skipped"} (+${r?.added ?? 0} transactions)`);
  }
  console.log(`SYNCED ${jobs.length} connection(s)`);
} finally {
  await close();
}
