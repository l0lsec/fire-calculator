#!/usr/bin/env node
// T4.3 G1: comparing a scenario with itself shows zero deltas everywhere (and a real change does not).
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/phase4.test.ts"],
  [
    "comparing a scenario with itself shows zero deltas everywhere",
    "prepaying a high-rate debt clears it sooner and costs less interest than investing the same dollars",
  ],
);
pass("COMPARE_IDENTITY_VERIFIED");
