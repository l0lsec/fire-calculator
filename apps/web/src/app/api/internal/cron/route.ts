// Daily safety-net sync: Plaid webhooks can be missed. Bearer-authenticated.
import { getDb } from "@/lib/db";
import { internalAuthorized } from "@/server/internal-auth";
import { plaidConfigured, plaidDeps } from "@/server/plaid/config";
import { cronJobs, enqueue } from "@/server/plaid/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!internalAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!plaidConfigured()) return Response.json({ ok: true, skipped: "plaid not configured" });
  const db = getDb();
  const deps = await plaidDeps();
  const jobs = await cronJobs(db);
  let failed = 0;
  for (const job of jobs) {
    try {
      await enqueue(db, deps, job);
    } catch {
      failed++;
    }
  }
  return Response.json({ ok: failed === 0, jobs: jobs.length, failed }, { status: failed ? 500 : 200 });
}
