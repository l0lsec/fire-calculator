#!/usr/bin/env node
// T4.2 G2: the same seed gives identical Monte Carlo output (and the generator is sound).
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/risk/risk.test.ts"],
  [
    "the same seed gives identical Monte Carlo output",
    "the generator is uniform and the normal has unit variance",
    "zero volatility reproduces the deterministic projection, and more money never lowers success",
  ],
);
pass("MONTE_CARLO_DETERMINISTIC_VERIFIED");
