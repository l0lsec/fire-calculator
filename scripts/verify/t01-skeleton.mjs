#!/usr/bin/env node
// T0.1 G1: the workspace typechecks, lints and runs its test suite.
import { pass, run } from "./lib.mjs";

run("pnpm", ["-s", "typecheck"]);
run("pnpm", ["-s", "lint"]);
run("pnpm", ["exec", "vitest", "run", "--passWithNoTests"]);
pass("SKELETON_VERIFIED");
