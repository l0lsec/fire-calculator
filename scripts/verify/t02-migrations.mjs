#!/usr/bin/env node
// T0.2 G1: migrations apply to an empty database, re-apply as a no-op, and match schema.ts.
import { join } from "node:path";
import { assert, pass, ROOT, run, vitest } from "./lib.mjs";

vitest(["packages/db/test/db.test.ts"], ["apply to an empty database and re-apply as a no-op"]);
const gen = run("pnpm", ["exec", "drizzle-kit", "generate"], { cwd: join(ROOT, "packages/db") });
assert(
  /No schema changes/i.test(gen.out),
  "schema.ts has changes with no migration (run drizzle-kit generate)",
);
const dirty = run("git", ["status", "--porcelain", "packages/db/drizzle"]);
assert(dirty.out.trim() === "" || !/^\?\?/m.test(dirty.out), "drizzle-kit generated a new migration file");
pass("MIGRATIONS_VERIFIED");
