#!/usr/bin/env node
// T1.5 G1: every FI level and the Coast FI and FI months match the plan fixture.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/levels/levels.test.ts"],
  [
    "Lean FI, FI, Fat FI, Barista FI and Coast FI match the plan fixture, with the Coast FI and FI months",
    "the ladder lists every milestone in order",
  ],
);
pass("LEVELS_GOLDEN_VERIFIED");
