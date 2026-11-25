#!/usr/bin/env node
// T3.5 G1: a user-edited APR survives a later liabilities sync, while an unedited field updates.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["a user-edited APR survives a later liabilities sync while unedited fields update"],
);
pass("PROVENANCE_VERIFIED");
