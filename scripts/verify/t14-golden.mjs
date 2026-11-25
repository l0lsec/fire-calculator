#!/usr/bin/env node
// T1.4 G2: the projection reproduces the worked example's full FI month (279), plus retirement policy behavior.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/projection/projection.test.ts"],
  [
    "reproduces the plan's full FI month with no debts",
    "payoff at FI retires every balance from the portfolio at the transition",
    "keep mortgage pays the car off and keeps paying the mortgage minimum",
    "an underfunded retirement depletes and warns",
  ],
);
pass("PROJECTION_GOLDEN_VERIFIED");
