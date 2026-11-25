#!/usr/bin/env node
// T3.7 G2: delete-my-data leaves zero household rows except the audit tombstone.
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["disconnect removes the Item at Plaid; delete-my-data leaves zero household rows"],
);
playwright(
  ["e2e/specs/plaid-fake.spec.ts"],
  ["delete my data revokes the connection, purges the household and signs out"],
);
pass("PURGE_VERIFIED");
