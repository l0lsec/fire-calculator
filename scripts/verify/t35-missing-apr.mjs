#!/usr/bin/env node
// T3.5 G3: an empty card aprs array produces a "needs APR" task instead of 0%.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["an empty card aprs array produces a 'needs APR' task instead of 0%"],
);
pass("MISSING_APR_VERIFIED");
