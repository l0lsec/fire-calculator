#!/usr/bin/env node
// T0.3 G1: without an AAL2 session, every page redirects and every API route
// returns 401, except the public allowlist (auth pages, Plaid webhook,
// internal routes). Checked over HTTP against the production build, plus a
// static check that every page, route and server action asks for a context.
// The AI endpoints (/api/mcp, /api/v1/) skip the session check in middleware
// but still answer 401 here: they need an AI access key instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assert, pass, ROOT, vitest } from "./lib.mjs";
import { discoverRoutes, startServer } from "./server.mjs";

const PUBLIC = [/^\/sign-in/, /^\/sign-up/, /^\/auth\//, /^\/api\/plaid\/webhook/, /^\/api\/internal\//];
const isPublic = (p) => PUBLIC.some((re) => re.test(p));

vitest(["apps/web/test/access.test.ts"], ["covers every discovered route"]);

// Static: data-bearing pages, API routes and server actions call the auth context.
const app = join(ROOT, "apps/web/src/app");
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) {
      const rel = p.slice(app.length);
      const text = readFileSync(p, "utf8");
      const needs =
        /^\/\(app\)\/.*page\.tsx$/.test(rel) ||
        (/^\/api\/.*route\.ts$/.test(rel) && !/^\/api\/(plaid\/webhook|internal)\//.test(rel)) ||
        /^["']use server["']/m.test(text);
      if (needs && !/require(Api|ApiKey)?Context\(/.test(text)) offenders.push(rel);
    }
  }
};
walk(app);
assert(offenders.length === 0, `no auth context call in: ${offenders.join(", ")}`);

const { pages, apis } = discoverRoutes();
assert(pages.length >= 2 && apis.length >= 1, "route discovery found too little");
const server = await startServer();
const problems = [];
try {
  for (const path of pages) {
    const res = await fetch(server.url + path, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    if (isPublic(path) || path === "/") {
      if (path === "/" ? !(res.status >= 300 && res.status < 400) : res.status !== 200)
        problems.push(`${path} -> ${res.status}`);
    } else if (path === "/mfa") {
      if (!(res.status >= 300 && res.status < 400 && loc.includes("/sign-in")))
        problems.push(`${path} -> ${res.status} ${loc}`);
    } else if (!(res.status >= 300 && res.status < 400 && loc.includes("/sign-in"))) {
      problems.push(`page ${path} -> ${res.status} ${loc}`);
    }
  }
  for (const path of apis) {
    if (isPublic(path)) continue;
    for (const method of ["GET", "POST"]) {
      const res = await fetch(server.url + path, { method, redirect: "manual" });
      if (res.status !== 401) problems.push(`api ${method} ${path} -> ${res.status}`);
    }
  }
} finally {
  await server.stop();
}
assert(problems.length === 0, `unprotected routes:\n${problems.join("\n")}`);
console.log(`checked ${pages.length} pages and ${apis.length} API routes over HTTP`);
pass("AUTH_ROUTES_VERIFIED");
