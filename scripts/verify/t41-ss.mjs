#!/usr/bin/env node
// T4.1 G2: Social Security lowers the target only from the claim age onward.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/withdrawal/withdrawal.test.ts"],
  ["Social Security lowers the target only from the claim age onward"],
);
pass("SS_VERIFIED");
