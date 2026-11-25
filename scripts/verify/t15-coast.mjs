#!/usr/bin/env node
// T1.5 G2: simulated Coast FI dates match the closed form within one month (non-vacuously).
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/levels/levels.test.ts"],
  ["the simulated Coast FI date equals the closed form within one month"],
);
pass("COAST_CROSSCHECK_VERIFIED");
