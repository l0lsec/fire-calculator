#!/usr/bin/env node
// T1.2 G1: avalanche and snowball reproduce the BUILD_PLAN section 10 fixture.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/debt/debt.test.ts"],
  ["avalanche matches the plan fixture to the cent", "snowball matches the plan fixture to the cent"],
);
pass("DEBT_GOLDEN_VERIFIED");
