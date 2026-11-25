#!/usr/bin/env node
// T1.4 G1: real and nominal series agree (identical at zero inflation; within a cent per $1M otherwise).
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/projection/projection.test.ts"],
  [
    "with zero inflation the real and nominal series are identical",
    "a nominal run deflated equals the same plan run in real terms",
  ],
);
pass("REAL_NOMINAL_VERIFIED");
