// Queue consumer target: runs one sync job. Bearer-authenticated (CRON_SECRET).
import { getDb } from "@/lib/db";
import { internalAuthorized } from "@/server/internal-auth";
import { plaidDeps } from "@/server/plaid/config";
import { runJob, SyncJob } from "@/server/plaid/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!internalAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const job = SyncJob.safeParse(await request.json().catch(() => null));
  if (!job.success) return Response.json({ error: "bad job" }, { status: 400 });
  const report = await runJob(getDb(), await plaidDeps(), job.data);
  return Response.json({ ok: true, report });
}
