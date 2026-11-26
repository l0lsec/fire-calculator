"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { safeNext } from "@/lib/auth/access";
import { supabaseBrowser } from "@/lib/auth/browser";

export function CredentialsForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  // Values are read from the form on submit (uncontrolled inputs), so text
  // typed or autofilled before React hydrates is never lost.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Disabled until hydrated: a click before then would fall back to a native
  // form submit. (method="post" below keeps credentials out of the URL even so.)
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const next = safeNext(params.get("next"));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const res =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    if (mode === "sign-up" && !res.data.session) {
      setError("Check your email to confirm your account, then sign in.");
      return;
    }
    // Every account needs a second factor before it can see financial data.
    router.replace(`/mfa?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} method="post" className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" name="email" required />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint={
          mode === "sign-up"
            ? "At least 10 characters with upper and lower case letters and a digit."
            : undefined
        }
      >
        <Input
          id="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          name="password"
          required
        />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button type="submit" disabled={busy || !ready}>
        {busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        {mode === "sign-in" ? (
          <>
            New here?{" "}
            <Link className="text-accent underline" href="/sign-up">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Have an account?{" "}
            <Link className="text-accent underline" href="/sign-in">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
