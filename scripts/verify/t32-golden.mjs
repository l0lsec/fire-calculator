#!/usr/bin/env node
// T3.2 G1: the fixture household's spending equals the hand-computed total.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/spending/test/spending.test.ts"],
  ["spending equals the hand-computed total with every exclusion applied"],
);
pass("SPENDING_GOLDEN_VERIFIED");
