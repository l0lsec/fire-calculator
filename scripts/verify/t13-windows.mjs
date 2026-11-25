#!/usr/bin/env node
// T1.3 G2: age windows (health cost to 65, part-time, Social Security) are exact.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/cashflow/cashflow.test.ts"],
  [
    "health cost stops in the month the person turns 65 and part-time income respects its window",
    "contributions are paid only while working and grow with raises",
  ],
);
pass("WINDOWS_VERIFIED");
