#!/usr/bin/env node
// T5.3 G1: the production health check passes against the deployed app.
// Needs APP_URL (https) and CRON_SECRET for the deployment.
import { assert, pass, run } from "./lib.mjs";

assert(
  process.env.APP_URL && process.env.CRON_SECRET,
  "set APP_URL and CRON_SECRET for the deployed app (see docs/RUNBOOK.md)",
);
const pre = run("node", ["ops/preflight.mjs"]);
assert(pre.out.includes("PREFLIGHT_OK"), "preflight failed");
const h = run("node", ["ops/health.mjs"]);
assert(h.out.includes("PRODUCTION_HEALTH_VERIFIED"), "health check failed");
pass("PRODUCTION_HEALTH_VERIFIED");
