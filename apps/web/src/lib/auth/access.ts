// The single access policy (BUILD_PLAN section 12), as a pure function so the
// middleware, the server context and the route gate all share one truth.
//
// - Public: auth pages, the Plaid webhook (it verifies Plaid's JWT instead),
//   internal cron/queue routes (they verify a bearer secret instead), and the
//   AI endpoints /api/mcp and /api/v1/ (they verify an AI access key instead,
//   which only an AAL2 session can create).
// - /mfa: needs a signed-in session (AAL1 is enough: that is where AAL2 is earned).
// - Everything else needs AAL2 (password plus TOTP). Pages redirect; APIs get 401.

export type Aal = "aal1" | "aal2";
export type Access = { kind: "allow" } | { kind: "redirect"; to: string } | { kind: "unauthorized" };

export const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/auth/",
  "/api/plaid/webhook",
  "/api/internal/",
  "/api/mcp",
  "/api/v1/",
  "/_next/",
  "/favicon.ico",
  "/robots.txt",
] as const;

export function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

function withNext(base: string, pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/sign-in")) return base;
  return `${base}?next=${encodeURIComponent(pathname)}`;
}

export function decideAccess(pathname: string, aal: Aal | null): Access {
  if (isPublic(pathname)) return { kind: "allow" };
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  if (isApi) return aal === "aal2" ? { kind: "allow" } : { kind: "unauthorized" };
  if (pathname === "/mfa")
    return aal ? { kind: "allow" } : { kind: "redirect", to: withNext("/sign-in", "/mfa") };
  if (aal === null) return { kind: "redirect", to: withNext("/sign-in", pathname) };
  if (aal === "aal1") return { kind: "redirect", to: withNext("/mfa", pathname) };
  return { kind: "allow" };
}

/** Only same-site relative paths are honored as post-login destinations. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}

export function aalOf(claims: Record<string, unknown> | null | undefined): Aal | null {
  if (!claims || typeof claims.sub !== "string") return null;
  return claims.aal === "aal2" ? "aal2" : "aal1";
}
