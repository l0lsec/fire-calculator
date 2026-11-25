#!/usr/bin/env node
import { playwright } from "./e2e.mjs";
// T5.1 G1: a replayed valid webhook is rejected and CSP headers are present on every app route
// (including redirects and 401s), and pages work under that CSP in a real browser.
import { assert, pass, vitest } from "./lib.mjs";
import { discoverRoutes, startServer } from "./server.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["a verified SYNC_UPDATES_AVAILABLE brings new rows; unsigned and replayed requests are refused"],
);
vitest(
  ["apps/web/test/security.test.ts"],
  [
    "the CSP is nonce-based, strict-dynamic, framing-denied, and allows only Plaid's hosts",
    "the rate limiter allows the limit and blocks beyond it until the window resets",
    "internal routes require the exact bearer secret",
  ],
);

const { pages, apis } = discoverRoutes();
const server = await startServer();
const problems = [];
try {
  for (const path of [...pages, ...apis]) {
    for (const method of apis.includes(path) ? ["GET", "POST"] : ["GET"]) {
      const res = await fetch(server.url + path, { method, redirect: "manual" });
      const csp = res.headers.get("content-security-policy") ?? "";
      if (!/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp))
        problems.push(`${method} ${path} (${res.status}): no nonce CSP`);
      if (!csp.includes("frame-ancestors 'none'")) problems.push(`${method} ${path}: framing allowed`);
      if (res.headers.get("x-content-type-options") !== "nosniff")
        problems.push(`${method} ${path}: no nosniff`);
      if (res.headers.get("x-frame-options") !== "DENY")
        problems.push(`${method} ${path}: no X-Frame-Options`);
    }
  }
  // Two requests get different nonces.
  const a = (await fetch(`${server.url}/sign-in`)).headers.get("content-security-policy");
  const b = (await fetch(`${server.url}/sign-in`)).headers.get("content-security-policy");
  if (a === b) problems.push("nonce is not per request");
} finally {
  await server.stop();
}
assert(problems.length === 0, problems.join("\n"));
console.log(`headers checked on ${pages.length} pages and ${apis.length} API routes`);
playwright(
  ["e2e/specs/security.spec.ts"],
  ["pages render under the strict CSP with nonced scripts and no violations"],
);
pass("SECURITY_HEADERS_VERIFIED");
