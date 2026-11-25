#!/usr/bin/env node
// node-4: scenarios render success rates and accessible-FI warnings; export works over HTTP.
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

vitest(["packages/engine/test/withdrawal/withdrawal.test.ts", "packages/engine/test/risk/risk.test.ts"]);
playwright(
  ["e2e/specs/phase4.spec.ts"],
  [
    "scenarios render success rates and a traditional-heavy early FI shows the access warning",
    "the JSON export downloads the plan without any tokens",
  ],
);
pass("ADVANCED_INTEGRATION_VERIFIED");
