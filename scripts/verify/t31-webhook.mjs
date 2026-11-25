#!/usr/bin/env node
// T3.1 G2: the verifier accepts a valid token and rejects bad hash, stale iat, unknown kid, alg none.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/plaid/test/plaid.test.ts"],
  [
    "accepts a valid signed fixture and rejects a wrong body hash, a stale iat, an unknown kid and alg none",
    "rejects a token signed by a different key under the right kid, and an expired key",
  ],
);
pass("WEBHOOK_VERIFY_VERIFIED");
