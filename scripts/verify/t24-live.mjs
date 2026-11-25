#!/usr/bin/env node
// T2.4 G1: moving the slider updates the debt-free date without a network request.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/debts.spec.ts"],
  ["moving the slider updates the debt-free date without a network request"],
);
pass("DEBT_LIVE_VERIFIED");
