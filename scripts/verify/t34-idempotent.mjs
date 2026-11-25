#!/usr/bin/env node
// T3.4 G1: sync is idempotent, removals delete, and a mutation during pagination restarts cleanly.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  [
    "running sync twice yields the same rows; removed transactions are deleted; a mutation during pagination restarts cleanly",
  ],
);
pass("SYNC_IDEMPOTENT_VERIFIED");
