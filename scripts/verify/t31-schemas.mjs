#!/usr/bin/env node
// T3.1 G1: recorded Sandbox responses for every endpoint parse; a response
// missing a required field fails validation. Recordings come from `pnpm plaid:record`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assert, pass, ROOT, vitest } from "./lib.mjs";

const REQUIRED = [
  "link_token_create.json",
  "item_public_token_exchange.json",
  "item_get.json",
  "accounts_get.json",
  "transactions_sync.json",
  "liabilities_get.json",
  "investments_holdings_get.json",
  "webhook_verification_key_get.json",
  "item_remove.json",
];
const dir = join(ROOT, "packages/plaid/test/recorded");
const missing = REQUIRED.filter((f) => !existsSync(join(dir, f)));
assert(
  missing.length === 0,
  `no recorded Sandbox response for: ${missing.join(", ")} (run pnpm plaid:record)`,
);
vitest(
  ["packages/plaid/test/plaid.test.ts"],
  [
    "recorded Sandbox responses parse, when recorded",
    "every endpoint's response parses (fake responses shaped like Plaid's)",
    "a response missing a required field fails validation",
  ],
);
pass("PLAID_SCHEMAS_VERIFIED");
