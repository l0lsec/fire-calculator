"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { safeNext } from "@/lib/auth/access";
import { supabaseBrowser } from "@/lib/auth/browser";

type Stage =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string };

export function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.error) {
      router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }
    if (aal.data.currentLevel === "aal2") {
      router.replace(next);
      return;
    }
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) {
      setError(factors.error.message);
      return;
    }
    const verified = factors.data.totp.find((f) => f.status === "verified");
    if (verified) {
      setStage({ kind: "verify", factorId: verified.id });
      return;
    }
    // Clear abandoned enrolments, then start a fresh one.
    for (const f of factors.data.all.filter((x) => x.status === "unverified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const enrolled = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${Date.now()}`,
    });
    if (enrolled.error) {
      setError(enrolled.error.message);
      return;
    }
    setStage({
      kind: "enroll",
      factorId: enrolled.data.id,
      qr: enrolled.data.totp.qr_code,
      secret: enrolled.data.totp.secret,
    });
  }, [next, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (stage.kind === "loading") return;
    setBusy(true);
    setError(null);
    const res = await supabaseBrowser().auth.mfa.challengeAndVerify({
      factorId: stage.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (res.error) {
      setError("That code did not match. Codes change every 30 seconds; try the current one.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      {stage.kind === "loading" ? <p className="text-sm text-ink-3">Checking your account...</p> : null}
      {stage.kind === "enroll" ? (
        <>
          <p className="text-sm text-ink-2">
            Your financial data is protected by a second factor. Scan this code with an authenticator app
            (1Password, Google Authenticator, Authy), then enter the 6-digit code it shows.
          </p>
          {/* biome-ignore lint/performance/noImgElement: the QR is a data URI from Supabase, not an optimizable asset */}
          <img
            src={stage.qr}
            alt="QR code for your authenticator app"
            className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
          />
          <p className="break-all text-center text-xs text-ink-3">
            Or enter this key:{" "}
            <span className="font-mono" data-testid="totp-secret">
              {stage.secret}
            </span>
          </p>
        </>
      ) : null}
      {stage.kind === "verify" ? (
        <p className="text-sm text-ink-2">Enter the 6-digit code from your authenticator app.</p>
      ) : null}
      {stage.kind !== "loading" ? (
        <>
          <Field label="Verification code" htmlFor="code">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Verifying..." : "Verify"}
          </Button>
        </>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </form>
  );
}
