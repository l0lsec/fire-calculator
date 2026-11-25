#!/usr/bin/env node
// T0.1 G3: the OpenNext worker bundle builds and wrangler accepts it.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, pass, ROOT, run } from "./lib.mjs";

const web = join(ROOT, "apps/web");
run("node", ["scripts/build-worker.mjs"], { cwd: web });
const out = mkdtempSync(join(tmpdir(), "fire-bundle-"));
try {
  run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", out], { cwd: web });
  const size = statSync(join(out, "index.js")).size;
  assert(size > 10_000, `bundle suspiciously small: ${size} bytes`);
  console.log(`bundle index.js: ${size} bytes`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
pass("BUNDLE_VERIFIED");
