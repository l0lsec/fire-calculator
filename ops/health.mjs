#!/usr/bin/env node
// Post-deploy production health check (T5.3 G1). Usage:
//   APP_URL=https://fire.example.com CRON_SECRET=... node ops/health.mjs
// Passes only if: the database answers; Plaid is configured for production with
// no base-URL override; the webhook URL points at this app and refuses an
// unsigned request; the date is not pinned; a cron trigger is configured.
import { readFileSync } from "node:fs";

const url = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
const problems = [];
if (!url || !url.startsWith("https://")) problems.push("APP_URL must be the https URL of the deployed app");
if (!secret) problems.push("CRON_SECRET must be set");
if (problems.length) {
  for (const p of problems) console.error(`HEALTH FAIL: ${p}`);
  process.exit(1);
}

const res = await fetch(`${url}/api/internal/health`, { headers: { authorization: `Bearer ${secret}` } });
const h = res.ok ? await res.json() : null;
if (!h) problems.push(`health endpoint returned ${res.status}`);
else {
  if (!h.db) problems.push("database not reachable");
  if (h.plaidEnv !== "production") problems.push(`PLAID_ENV is ${h.plaidEnv}, expected production`);
  if (!h.plaidConfigured) problems.push("Plaid keys missing");
  if (h.plaidBaseOverride) problems.push("PLAID_BASE_URL is set (points Plaid calls away from Plaid)");
  if (h.asOfPinned) problems.push("FIRE_AS_OF is set in production");
  if (!h.webhookUrl || !String(h.webhookUrl).startsWith(`${url}/api/plaid/webhook`))
    problems.push(`webhook URL ${h.webhookUrl} does not point at this app`);
  if (h.keyVersions < 1) problems.push("TOKEN_ENCRYPTION_KEYS missing");
}
const unsigned = await fetch(`${url}/api/plaid/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }),
});
if (unsigned.status !== 401) problems.push(`unsigned webhook got ${unsigned.status}, expected 401`);
const wrangler = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
if (!/"crons"\s*:\s*\[\s*"[^"]+"/.test(wrangler)) problems.push("no cron trigger configured");

if (problems.length) {
  for (const p of problems) console.error(`HEALTH FAIL: ${p}`);
  process.exit(1);
}
console.log("PRODUCTION_HEALTH_VERIFIED");
