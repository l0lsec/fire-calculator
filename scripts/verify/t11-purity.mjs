#!/usr/bin/env node
// T1.1 G2: the engine is pure (guard passes on the tree, trips on fixtures),
// and the engine package typechecks.
import { assert, pass, run } from "./lib.mjs";

const self = run("node", ["scripts/guards/run-all.mjs", "--selftest"]);
assert(self.out.includes("GUARDS_SELFTEST_OK"), "guard self-test failed");
const tree = run("node", ["scripts/guards/run-all.mjs"]);
assert(tree.out.includes("GUARDS_CLEAN"), "guards found violations");
run("pnpm", ["--filter", "@fire/engine", "-s", "typecheck"]);
pass("ENGINE_PURE_VERIFIED");
