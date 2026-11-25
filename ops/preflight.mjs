#!/usr/bin/env node
// Pre-deploy checks of the committed production config (run before `pnpm deploy`).
import { readFileSync } from "node:fs";

const w = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");
const problems = [];
if (/"id":\s*"0{32}"/.test(w))
  problems.push("Hyperdrive id is still the placeholder (create one: see docs/RUNBOOK.md step 3)");
if (!/"PLAID_ENV":\s*"production"/.test(w)) problems.push('vars.PLAID_ENV is not "production"');
if (!/"APP_BASE_URL":\s*"https:\/\//.test(w))
  problems.push("vars.APP_BASE_URL is not set to the https app URL");
if (/PLAID_BASE_URL|FIRE_AS_OF/.test(w)) problems.push("test-only variables appear in wrangler.jsonc");
if (problems.length) {
  for (const p of problems) console.error(`PREFLIGHT FAIL: ${p}`);
  process.exit(1);
}
console.log("PREFLIGHT_OK");
