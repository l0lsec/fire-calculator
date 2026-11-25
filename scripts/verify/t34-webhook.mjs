#!/usr/bin/env node
// T3.4 G2 (real Plaid Sandbox): /sandbox/item/fire_webhook SYNC_UPDATES_AVAILABLE reaches the app
// through a temporary tunnel, is verified and processed; an unsigned request gets 401.
import { pass } from "./lib.mjs";
import { sandboxE2E } from "./sandbox-e2e.mjs";

await sandboxE2E(["a fired SYNC_UPDATES_AVAILABLE from the real Sandbox is verified and processed"], {
  tunnel: true,
});
pass("WEBHOOK_FLOW_VERIFIED");
