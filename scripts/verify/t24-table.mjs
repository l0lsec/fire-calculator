#!/usr/bin/env node
// T2.4 G2: the comparison table shows 42 months for both strategies and the fixture's interest totals.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/debts.spec.ts"],
  ["the comparison table shows the worked example's months and interest"],
);
pass("DEBT_TABLE_VERIFIED");
