// Security headers (BUILD_PLAN section 12, T5.1). Every response carries a
// nonce-based Content-Security-Policy: scripts run only if Next stamped them
// with this request's nonce ('strict-dynamic' lets them load Plaid Link). Plaid
// Link's iframe and API hosts are allowed explicitly; nothing else is.

export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function buildCsp(nonce: string, opts: { dev?: boolean; supabaseUrl?: string } = {}): string {
  const supabase = opts.supabaseUrl ? new URL(opts.supabaseUrl).origin : "";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https://cdn.plaid.com",
      ...(opts.dev ? ["'unsafe-eval'"] : []),
    ],
    // Recharts and Next set inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(supabase ? [supabase] : []), "https://*.plaid.com"],
    "frame-src": ["https://cdn.plaid.com", "https://*.plaid.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export const STATIC_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function applySecurityHeaders(headers: Headers, csp: string, opts: { https?: boolean } = {}) {
  headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(STATIC_HEADERS)) headers.set(k, v);
  if (opts.https) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
