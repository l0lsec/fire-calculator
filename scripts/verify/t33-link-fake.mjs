#!/usr/bin/env node
// T3.3 G2: Link token, exchange and first sync through the app's API against the fake Plaid API.
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["a Link exchange stores a token that decrypts, and no response or log line contains it"],
);
playwright(
  ["e2e/specs/plaid-fake.spec.ts"],
  ["connect, sync and a verified webhook work end to end over HTTP"],
);
pass("LINK_FAKE_VERIFIED");
