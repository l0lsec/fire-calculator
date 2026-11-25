// Build the Workers bundle and prove it carries no local secrets.
//
// `opennextjs-cloudflare build` compiles local .env files into
// `.open-next/cloudflare/next-env.mjs` as a runtime fallback. Local .env files
// hold Plaid secrets and the token encryption key, so after building we blank
// that module, delete copied .env files, and scan the output for every
// sensitive value the local env files contain. Any hit fails the build.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = ".open-next";
const ENV_MODULE = path.join(OUT, "cloudflare", "next-env.mjs");
const SENSITIVE = /SECRET|KEY|PASSWORD|TOKEN|DATABASE_URL/i;
const SCRUBBED = "export const production = {};\nexport const development = {};\nexport const test = {};\n";

function parseDotenv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

execFileSync("pnpm", ["exec", "opennextjs-cloudflare", "build"], { stdio: "inherit" });

if (existsSync(ENV_MODULE)) writeFileSync(ENV_MODULE, SCRUBBED);
let removed = 0;
for (const p of [...walk(OUT)]) {
  if (/(^|\/)\.env(\.|$)/.test(p) || /(^|\/)\.dev\.vars$/.test(p)) {
    rmSync(p);
    removed++;
  }
}

const values = new Map();
for (const f of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".dev.vars",
  "../../.env",
]) {
  for (const [k, v] of Object.entries(parseDotenv(f))) {
    if (SENSITIVE.test(k) && v.length >= 12) values.set(`${f}:${k}`, v);
  }
}
const hits = [];
for (const p of walk(OUT)) {
  const buf = readFileSync(p, "latin1");
  for (const [where, v] of values) if (buf.includes(v)) hits.push(`${where} -> ${p}`);
}
if (hits.length) {
  console.error("build-worker: refusing to produce a bundle that contains local secrets:");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(
  `build-worker: removed ${removed} env file(s); verified ${values.size} sensitive value(s) absent`,
);
