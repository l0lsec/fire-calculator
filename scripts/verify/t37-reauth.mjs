#!/usr/bin/env node
// T3.7 G1 (real Plaid Sandbox): /sandbox/item/reset_login flips the Item to login_required,
// and update mode through Plaid Link restores healthy. Needs sandbox keys and ngrok.
import { pass, vitest } from "./lib.mjs";
import { sandboxE2E } from "./sandbox-e2e.mjs";

vitest(["apps/web/test/sandbox.test.ts"], ["Sandbox reset_login flips the Item to login_required"]);
await sandboxE2E(["update mode through Plaid Link restores a reset Item to Connected"]);
pass("REAUTH_VERIFIED");
