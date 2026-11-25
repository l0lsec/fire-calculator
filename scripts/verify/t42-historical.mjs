#!/usr/bin/env node
// T4.2 G1: on the bundled public data, 4%/30y/60-40 succeeds in 90% to 100% of rolling starts.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assert, pass, ROOT, run, vitest } from "./lib.mjs";

assert(
  existsSync(join(ROOT, "packages/engine/data/us-monthly.json")),
  "historical dataset missing: see packages/engine/data/SOURCES.md",
);
const c = run("node", ["scripts/data/build-us-monthly.test.mjs"]);
assert(c.out.includes("CONVERTER_OK"), "converter self-check failed");
vitest(
  ["packages/engine/test/risk/risk.test.ts"],
  [
    "a 4% withdrawal over 30 years on 60/40 succeeds in 90% to 100% of rolling historical starts",
    "rolling starts use the series in order and report failing start years",
  ],
);
pass("HISTORICAL_VERIFIED");
