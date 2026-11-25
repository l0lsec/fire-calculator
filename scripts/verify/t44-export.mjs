#!/usr/bin/env node
// T4.4 G1: a JSON export re-imported into an empty household reproduces the same projection.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/phase4.test.ts"],
  [
    "a JSON export re-imported into an empty household reproduces the same projection",
    "CSV export neutralizes spreadsheet formulas and quotes correctly",
    "net worth history carries balances forward and subtracts debts",
  ],
);
pass("EXPORT_ROUNDTRIP_VERIFIED");
