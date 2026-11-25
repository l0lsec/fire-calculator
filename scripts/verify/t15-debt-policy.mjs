#!/usr/bin/env node
// T1.5 G3: debt raises the FI target by exactly its balance; FI never moves earlier; policies behave.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/levels/levels.test.ts"],
  [
    "adding a debt raises the FI target by exactly its balance and never moves the FI date earlier",
    "keep mortgage counts less than the balance when returns beat the rate, and debt-free-first waits for consumer debt",
    "withdrawal tax grosses up the spending part only",
  ],
);
pass("DEBT_POLICY_VERIFIED");
