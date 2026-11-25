#!/usr/bin/env node
// T4.1 G1: FI at 45 all in traditional fails the accessible-FI check; a 5-year ladder covers from year 5.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/withdrawal/withdrawal.test.ts"],
  [
    "FI at 45 all in traditional fails; a 5-year ladder started at FI passes from year 5",
    "taxable money and Roth contribution basis bridge the gap; Rule of 55 opens traditional money",
    "weights ordinary and gains rates by bucket balance and cost basis",
  ],
);
pass("ACCESS_VERIFIED");
