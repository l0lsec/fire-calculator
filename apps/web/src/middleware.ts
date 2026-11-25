// Edge middleware: sets security headers (nonce-based CSP), refreshes the
// Supabase session cookie, and applies the access policy before any page or
// API route runs. Data access is guarded a second time on the server by
// requireContext(), which is the only way to get a household scope.
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { aalOf, decideAccess } from "./lib/auth/access";
import { applySecurityHeaders, buildCsp, makeNonce } from "./lib/security/headers";

export async function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    ...(process.env.NEXT_PUBLIC_SUPABASE_URL ? { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL } : {}),
  });
  // Next reads the CSP from the request to stamp its own scripts with the nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = next();
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  let aal: ReturnType<typeof aalOf> = null;
  try {
    const { data } = await supabase.auth.getClaims();
    aal = aalOf((data?.claims as Record<string, unknown> | undefined) ?? null);
  } catch {
    aal = null;
  }

  const https = request.nextUrl.protocol === "https:";
  const finish = (res: NextResponse) => {
    for (const c of response.cookies.getAll()) if (res !== response) res.cookies.set(c);
    applySecurityHeaders(res.headers, csp, { https });
    return res;
  };
  const decision = decideAccess(request.nextUrl.pathname, aal);
  if (decision.kind === "unauthorized")
    return finish(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  if (decision.kind === "redirect") return finish(NextResponse.redirect(new URL(decision.to, request.url)));
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
