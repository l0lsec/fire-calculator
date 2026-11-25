#!/usr/bin/env node
// T3.5 G2: every Plaid investment subtype maps to a bucket explicitly; loans and cards never become assets.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  [
    "every Plaid investment subtype maps to a bucket explicitly",
    "maps mortgage escrow, student loans, holdings with cost basis, and keeps loans out of assets",
  ],
);
pass("BUCKETS_VERIFIED");
