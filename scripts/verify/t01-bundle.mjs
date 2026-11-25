#!/usr/bin/env node
// T0.1 G3: the OpenNext worker bundle builds and wrangler accepts it.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { assert, pass, ROOT, run } from "./lib.mjs";

const web = join(ROOT, "apps/web");
run("node", ["scripts/build-worker.mjs"], { cwd: web });
const out = mkdtempSync(join(tmpdir(), "fire-bundle-"));
try {
  run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", out], { cwd: web });
  const size = statSync(join(out, "index.js")).size;
  assert(size > 10_000, `bundle suspiciously small: ${size} bytes`);
  // Workers Paid allows 10 MiB compressed per Worker (Free: 3 MiB).
  const gz = gzipSync(readFileSync(join(out, "index.js"))).length;
  assert(gz < 10 * 1024 * 1024, `compressed bundle ${gz} bytes exceeds the 10 MiB Workers limit`);
  console.log(`bundle index.js: ${size} bytes, ${gz} gzipped`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
pass("BUNDLE_VERIFIED");
