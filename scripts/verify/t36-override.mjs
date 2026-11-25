#!/usr/bin/env node
// T3.6 G1: marking a transaction one-time changes annual spending and the FI number by the expected amount.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/spending-review.test.ts"],
  [
    "marking a transaction one-time changes annual spending and the FI number by the expected amount",
    "category rules and decisions are validated and scoped",
  ],
);
pass("SPENDING_OVERRIDE_VERIFIED");
