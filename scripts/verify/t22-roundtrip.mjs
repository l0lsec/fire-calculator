#!/usr/bin/env node
// T2.2 G1: every assumption round-trips through the database and the zod schema unchanged.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/manual.test.ts"],
  [
    "every assumption round-trips through the database and the zod schema unchanged",
    "rejects contradictory assumptions",
  ],
);
pass("SCENARIO_ROUNDTRIP_VERIFIED");
