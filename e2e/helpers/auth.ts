// Creates a real user on the local Supabase stack with a verified TOTP factor
// and returns AAL2 session cookies for the browser context.
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { ENV } from "./env";
import { totp } from "./totp";

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  totpSecret: string;
  cookies: { name: string; value: string }[];
}

export async function createVerifiedUser(): Promise<TestUser> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(
    ENV.NEXT_PUBLIC_SUPABASE_URL as string,
    ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cs) => {
          for (const { name, value } of cs) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
    },
  );
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const password = `E2e${Math.random().toString(36).slice(2, 10)}A9`;
  const signed = await supabase.auth.signUp({ email, password });
  if (signed.error || !signed.data.user) throw new Error(`sign-up failed: ${signed.error?.message}`);
  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" });
  if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`);
  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totp(enrolled.data.totp.secret),
  });
  if (verified.error) throw new Error(`verify failed: ${verified.error.message}`);
  return {
    userId: signed.data.user.id,
    email,
    password,
    totpSecret: enrolled.data.totp.secret,
    cookies: [...jar].map(([name, value]) => ({ name, value })),
  };
}

export async function signInContext(context: BrowserContext, user: TestUser, baseURL: string) {
  const url = new URL(baseURL);
  await context.addCookies(
    user.cookies.map((c) => ({
      ...c,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}
