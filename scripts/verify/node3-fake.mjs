#!/usr/bin/env node
// node-3 N1: a connected household (fake Plaid over HTTP) goes from Link to measured
// spending that matches the T3.2 golden total, and can use it as the plan basis.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/plaid-fake.spec.ts"],
  ["measured spending from the connected bank matches the golden total"],
);
pass("PLAID_INTEGRATION_FAKE_VERIFIED");
