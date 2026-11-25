#!/usr/bin/env node
// T1.3 G1: escrow outlives the mortgage; principal and interest stop at payoff.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test/cashflow/cashflow.test.ts"],
  ["escrow continues after the mortgage payoff month while P&I stops"],
);
pass("ESCROW_VERIFIED");
