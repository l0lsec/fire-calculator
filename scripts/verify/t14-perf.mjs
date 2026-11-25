#!/usr/bin/env node
// T1.4 G3: a 600-month projection runs in under 50 ms in Node.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/projection/projection.test.ts"],
  ["a 600-month projection runs in under 50 ms"],
);
pass("PROJECTION_PERF_VERIFIED");
