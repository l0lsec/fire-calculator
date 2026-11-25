#!/usr/bin/env node
// T3.4 G3: signed webhooks delivered to the running app sync new rows; unsigned, tampered and replayed are refused.
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["a verified SYNC_UPDATES_AVAILABLE brings new rows; unsigned and replayed requests are refused"],
);
playwright(
  ["e2e/specs/plaid-fake.spec.ts"],
  ["connect, sync and a verified webhook work end to end over HTTP"],
);
pass("WEBHOOK_FLOW_FAKE_VERIFIED");
