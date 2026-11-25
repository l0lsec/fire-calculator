#!/usr/bin/env node
// T0.2 G2: no repository function crosses households; RLS blocks API roles;
// only auth and system code can mint a scope.
import { assert, pass, run, vitest } from "./lib.mjs";

vitest(
  ["packages/db/test/db.test.ts", "packages/db/test/concurrency.test.ts"],
  [
    "a cross-household read or write through every repository function touches nothing",
    "RLS blocks API roles even when a table privilege is granted by mistake",
    "provenance keeps a user's APR when Plaid syncs again",
    "concurrent first visits create exactly one household per user",
  ],
);
const self = run("node", ["scripts/guards/run-all.mjs", "--selftest"]);
assert(self.out.includes("GUARDS_SELFTEST_OK"), "guard self-test failed");
const tree = run("node", ["scripts/guards/run-all.mjs"]);
assert(tree.out.includes("GUARDS_CLEAN"), "guards found violations");
pass("ISOLATION_VERIFIED");
