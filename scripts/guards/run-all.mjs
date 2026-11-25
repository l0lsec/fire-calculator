#!/usr/bin/env node
// Runs every guard over the repository. With --selftest, also proves each guard
// trips on its own deliberate-violation fixtures (a guard that cannot fail is
// not a guard). Prints GUARDS_CLEAN / GUARDS_SELFTEST_OK only on success.
import * as emdash from "./emdash.mjs";
import { repoFiles } from "./lib.mjs";
import * as purity from "./purity.mjs";
import * as scope from "./scope.mjs";
import * as secrets from "./secrets.mjs";
import * as tokenLogging from "./token-logging.mjs";

const GUARDS = [purity, emdash, tokenLogging, scope, secrets];
const selftest = process.argv.includes("--selftest");
let failed = false;

if (selftest) {
  for (const g of GUARDS) {
    for (const fx of g.fixtures) {
      const v = g.scan([fx]);
      if (v.length === 0) {
        console.error(`SELFTEST FAIL ${g.name}: fixture ${fx.path} did not trip the guard`);
        failed = true;
      }
    }
    // A clean file must not trip the guard either.
    const clean = g.scan([{ path: "packages/engine/src/clean.ts", text: "export const ok = 1;\n" }]);
    if (clean.length) {
      console.error(`SELFTEST FAIL ${g.name}: clean fixture tripped: ${clean.join("; ")}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`GUARDS_SELFTEST_OK (${GUARDS.length} guards)`);
  process.exit(0);
}

const files = repoFiles();
for (const g of GUARDS) {
  const v = g.scan(files);
  for (const line of v) console.error(`GUARD ${g.name}: ${line}`);
  if (v.length) failed = true;
}
if (failed) process.exit(1);
console.log(`GUARDS_CLEAN (${files.length} files, ${GUARDS.length} guards)`);
