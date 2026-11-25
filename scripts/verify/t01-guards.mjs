#!/usr/bin/env node
// T0.1 G2: every guard trips on its violation fixtures, and the tree is clean.
import { assert, pass, run } from "./lib.mjs";

const self = run("node", ["scripts/guards/run-all.mjs", "--selftest"]);
assert(/GUARDS_SELFTEST_OK/.test(self.out), "guard self-test did not report success");
const clean = run("node", ["scripts/guards/run-all.mjs"]);
assert(/GUARDS_CLEAN/.test(clean.out), "guards did not report a clean tree");
pass("GUARDS_VERIFIED");
