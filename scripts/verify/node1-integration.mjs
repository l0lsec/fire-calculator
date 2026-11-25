#!/usr/bin/env node
// node-1: all engine suites pass together, the integrated golden holds, the engine is pure.
import { assert, pass, run, vitest } from "./lib.mjs";

vitest(
  ["packages/engine/test"],
  ["the worked example with its debts under the default policy is coherent end to end"],
);
const g = run("node", ["scripts/guards/run-all.mjs"]);
assert(g.out.includes("GUARDS_CLEAN"), "guards not clean");
pass("ENGINE_INTEGRATION_VERIFIED");
