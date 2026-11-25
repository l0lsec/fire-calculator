#!/usr/bin/env node
// T1.5 G4: bridged Barista FI with part-time income equal to expenses equals Coast FI.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/levels/levels.test.ts"],
  [
    "bridged Barista FI with part-time income equal to expenses equals Coast FI",
    "perpetual Barista FI subtracts part-time income and adds uncovered health cost",
  ],
);
pass("BARISTA_VERIFIED");
