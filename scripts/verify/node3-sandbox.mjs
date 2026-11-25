#!/usr/bin/env node
// node-3 N2: against the real Plaid Sandbox, Link, sync, webhook and re-auth all work.
import { pass, vitest } from "./lib.mjs";
import { sandboxE2E } from "./sandbox-e2e.mjs";

vitest(
  ["apps/web/test/sandbox.test.ts"],
  [
    "a Sandbox Link completes and the stored token decrypts",
    "Sandbox reset_login flips the Item to login_required",
  ],
);
await sandboxE2E([
  "a fired SYNC_UPDATES_AVAILABLE from the real Sandbox is verified and processed",
  "update mode through Plaid Link restores a reset Item to Connected",
]);
pass("PLAID_INTEGRATION_SANDBOX_VERIFIED");
