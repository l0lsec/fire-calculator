#!/usr/bin/env node
import { cleanDatabase } from "./clean-db.mjs";
import { playwright } from "./e2e.mjs";
// T5.2 G1: all e2e flows pass against the real Plaid Sandbox (needs keys and ngrok),
// after the fake-Plaid suite passes on a clean database.
import { pass } from "./lib.mjs";
import { sandboxE2E } from "./sandbox-e2e.mjs";

cleanDatabase();
playwright(["e2e/specs"]);
await sandboxE2E([
  "a fired SYNC_UPDATES_AVAILABLE from the real Sandbox is verified and processed",
  "update mode through Plaid Link restores a reset Item to Connected",
]);
pass("E2E_VERIFIED");
