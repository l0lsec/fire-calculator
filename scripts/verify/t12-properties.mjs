#!/usr/bin/env node
// T1.2 G2: payoff properties hold across generated debt sets.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/debt/debt.test.ts"],
  [
    "extra payment never delays payoff",
    "avalanche interest is never above snowball's beyond rounding",
    "balances never go negative and payments never exceed what is owed",
  ],
);
pass("DEBT_PROPERTIES_VERIFIED");
