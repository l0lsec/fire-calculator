import { describe, expect, it } from "vitest";
import { buildCsp, makeNonce } from "../src/lib/security/headers";
import { memoryLimit } from "../src/lib/security/rate-limit";
import { internalAuthorized } from "../src/server/internal-auth";

describe("security primitives", () => {
  it("the CSP is nonce-based, strict-dynamic, framing-denied, and allows only Plaid's hosts", () => {
    const n = makeNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(n);
    const csp = buildCsp(n, { supabaseUrl: "http://127.0.0.1:58321/auth" });
    expect(csp).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic' https://cdn.plaid.com`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:58321 https://*.plaid.com");
    expect(buildCsp(n, { dev: true })).toContain("'unsafe-eval'");
  });

  it("the rate limiter allows the limit and blocks beyond it until the window resets", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(memoryLimit(key, 5, 60_000, 1000)).toBe(true);
    expect(memoryLimit(key, 5, 60_000, 1000)).toBe(false);
    expect(memoryLimit(key, 5, 60_000, 61_001)).toBe(true);
  });

  it("internal routes require the exact bearer secret", () => {
    const secret = "s".repeat(32);
    const req = (h?: string) =>
      new Request("http://x/api/internal/cron", { headers: h ? { authorization: h } : {} });
    expect(internalAuthorized(req(`Bearer ${secret}`), secret)).toBe(true);
    expect(internalAuthorized(req(`Bearer ${secret}x`), secret)).toBe(false);
    expect(internalAuthorized(req(), secret)).toBe(false);
    expect(internalAuthorized(req("Bearer short"), "short")).toBe(false);
  });
});
