// Edge middleware: refreshes the Supabase session cookie and applies the
// access policy before any page or API route runs. Data access is guarded a
// second time on the server by requireContext(), which is the only way to get
// a household scope.
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { aalOf, decideAccess } from "./lib/auth/access";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
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

  const decision = decideAccess(request.nextUrl.pathname, aal);
  const carryCookies = (res: NextResponse) => {
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    return res;
  };
  if (decision.kind === "unauthorized") {
    return carryCookies(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }
  if (decision.kind === "redirect") {
    return carryCookies(NextResponse.redirect(new URL(decision.to, request.url)));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
