#!/usr/bin/env node
// T0.3 G2: a password-only (AAL1) session cannot read household data; the same
// user after TOTP verification (AAL2) can. Runs against the local Supabase
// stack (pnpm db:up) and the production Next build.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { assert, fail, pass, ROOT } from "./lib.mjs";
import { startServer } from "./server.mjs";
import { selfTest, totp } from "./totp.mjs";

selfTest();
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(SUPABASE_URL && ANON && env.DATABASE_URL, ".env lacks the local Supabase settings");
try {
  await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON } });
} catch {
  fail("local Supabase is not running (pnpm db:up)");
}

const req = createRequire(join(ROOT, "apps/web/package.json"));
const { createServerClient } = req("@supabase/ssr");
const postgres = createRequire(join(ROOT, "packages/db/package.json"))("postgres");

const jar = new Map();
const supabase = createServerClient(SUPABASE_URL, ANON, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => {
      for (const { name, value } of cs) value ? jar.set(name, value) : jar.delete(name);
    },
  },
});
const cookie = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

const email = `gate-${Date.now()}@example.test`;
const password = `Gate${Math.random().toString(36).slice(2, 10)}A1`;
const signed = await supabase.auth.signUp({ email, password });
assert(!signed.error && signed.data.session, `sign-up failed: ${signed.error?.message}`);
const userId = signed.data.user.id;

const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
const server = await startServer();
try {
  const get = (path, headers = {}) =>
    fetch(server.url + path, { redirect: "manual", headers: { cookie: cookie(), ...headers } });

  // AAL1: pages bounce to /mfa, APIs refuse, no household is ever created.
  let r = await get("/dashboard");
  assert(
    r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/mfa"),
    `AAL1 /dashboard -> ${r.status} ${r.headers.get("location")}`,
  );
  r = await get("/api/me");
  assert(r.status === 401, `AAL1 /api/me -> ${r.status}`);
  r = await get("/mfa");
  assert(r.status === 200, `AAL1 /mfa -> ${r.status}`);
  let rows = await sql`select household_id from fire.household_members where user_id = ${userId}`;
  assert(rows.length === 0, "a household was created for an AAL1 session");

  // A garbage session cookie is treated as signed out.
  r = await fetch(`${server.url}/dashboard`, {
    redirect: "manual",
    headers: { cookie: cookie().replace(/=([^;]{20})/, "=x$1") },
  });
  assert(r.status >= 300 && r.status < 400, `tampered cookie -> ${r.status}`);

  // Enroll and verify TOTP: AAL2.
  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "gate" });
  assert(!enrolled.error, `enroll failed: ${enrolled.error?.message}`);
  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totp(enrolled.data.totp.secret),
  });
  assert(!verified.error, `verify failed: ${verified.error?.message}`);

  r = await get("/dashboard");
  assert(r.status === 200, `AAL2 /dashboard -> ${r.status}`);
  r = await get("/api/me");
  assert(r.status === 200, `AAL2 /api/me -> ${r.status}`);
  const me = await r.json();
  rows = await sql`select household_id from fire.household_members where user_id = ${userId}`;
  assert(rows.length === 1 && rows[0].household_id === me.householdId, "AAL2 household mismatch");
  console.log(`AAL1 refused, AAL2 admitted for ${email}`);
} finally {
  await server.stop();
  await sql.end();
}
pass("MFA_VERIFIED");
