// Operational health (bearer CRON_SECRET): database reachable, Plaid configured
// for the expected environment, webhook URL and keyring present. Reports no
// secret values, only facts about them.
import { databaseReachable } from "@fire/db";
import { getDb } from "@/lib/db";
import { internalAuthorized } from "@/server/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!internalAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = await databaseReachable(getDb());
  const keyVersions = (process.env.TOKEN_ENCRYPTION_KEYS ?? "")
    .split(",")
    .filter((s) => /^\d+:/.test(s.trim())).length;
  const body = {
    db,
    plaidEnv: process.env.PLAID_ENV ?? "sandbox",
    plaidConfigured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    plaidBaseOverride: Boolean(process.env.PLAID_BASE_URL),
    webhookUrl: process.env.PLAID_WEBHOOK_URL ?? null,
    keyVersions,
    asOfPinned: Boolean(process.env.FIRE_AS_OF),
  };
  return Response.json(body, { status: db ? 200 : 503 });
}
