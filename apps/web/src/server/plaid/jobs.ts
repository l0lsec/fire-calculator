// Sync jobs: what a webhook or the daily cron asks for, and how it runs.
// On Workers, jobs go to the SYNC_QUEUE (the webhook returns 200 at once);
// in Node (dev, tests) they run inline.
import { type Db, getItem, listHealthyItemsForSync, scopeFor } from "@fire/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import type { PlaidDeps } from "./config";
import { ALL_PARTS, type SyncReport, syncItem } from "./sync";

export const SyncJob = z.object({
  householdId: z.string().uuid(),
  itemId: z.string().uuid(),
  parts: z.array(z.enum(["accounts", "transactions", "liabilities", "holdings"])).min(1),
  reason: z.string(),
});
export type SyncJob = z.infer<typeof SyncJob>;

interface Queue {
  send: (body: unknown) => Promise<void>;
}

function queue(): Queue | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { SYNC_QUEUE?: Queue }).SYNC_QUEUE ?? null;
  } catch {
    return null;
  }
}

export async function runJob(db: Db, deps: PlaidDeps, job: SyncJob): Promise<SyncReport | null> {
  const scope = scopeFor(job.householdId);
  const item = await getItem(db, scope, job.itemId);
  if (!item || item.status === "revoked") return null;
  return syncItem({ db, scope }, deps, job.itemId, job.parts);
}

/** Queue a job (Workers) or run it now (Node). */
export async function enqueue(db: Db, deps: PlaidDeps, job: SyncJob): Promise<"queued" | "ran"> {
  const q = queue();
  if (q) {
    await q.send(job);
    return "queued";
  }
  await runJob(db, deps, job);
  return "ran";
}

/** The daily safety net: a full sync for every healthy Item. */
export async function cronJobs(db: Db): Promise<SyncJob[]> {
  const items = await listHealthyItemsForSync(db);
  return items.map((i) => ({ householdId: i.householdId, itemId: i.id, parts: ALL_PARTS, reason: "cron" }));
}
