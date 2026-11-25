#!/usr/bin/env node
// T2.1 G1: a household entered by hand produces an EngineInput that passes the engine schema.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/manual.test.ts"],
  [
    "a household entered by hand produces an EngineInput that passes the engine schema",
    "a debt with no rate becomes an issue, not a 0% loan",
  ],
);
pass("SNAPSHOT_VERIFIED");
