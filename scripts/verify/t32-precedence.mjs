#!/usr/bin/env node
// T3.2 G3: user overrides beat rules, and rules beat PFC defaults.
import { assert, pass, run, vitest } from "./lib.mjs";

vitest(
  ["packages/spending/test/spending.test.ts"],
  [
    "user overrides beat rules, and rules beat PFC defaults",
    "one-time handling: flagged, excluded or amortized on request",
  ],
);
const g = run("node", ["scripts/guards/run-all.mjs"]);
assert(g.out.includes("GUARDS_CLEAN"), "spending package must stay pure");
pass("PRECEDENCE_VERIFIED");
