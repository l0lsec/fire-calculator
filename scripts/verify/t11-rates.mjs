#!/usr/bin/env node
// T1.1 G1: rate and time conversions round-trip under property tests.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/core/core.test.ts"],
  [
    "nominal to real and back round-trips",
    "monthly and annual rates round-trip",
    "toReal and toNominal are inverses",
    "month index and label round-trip",
    "fills defaults",
  ],
);
pass("RATES_VERIFIED");
