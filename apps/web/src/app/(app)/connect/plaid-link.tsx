"use client";
// Opens Plaid Link. New connections exchange the public token on the server;
// update mode (re-authentication, new accounts) only needs a refresh after.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { explainError } from "@/lib/explain-error";

/** Our own wording, safe to show as is; anything else goes through explainError. */
class Shown extends Error {}

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}
interface PlaidGlobal {
  create: (opts: {
    token: string;
    onSuccess: (
      publicToken: string,
      metadata: { institution: { institution_id: string; name: string } | null },
    ) => void;
    onExit: (
      err: { error_code?: string; error_message?: string; display_message?: string | null } | null,
    ) => void;
  }) => PlaidHandler;
}

const SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadPlaid(): Promise<PlaidGlobal> {
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () =>
      w.Plaid
        ? resolve(w.Plaid)
        : reject(new Shown("Could not open the bank window. Reload the page and try again."));
    s.onerror = () =>
      reject(new Shown("Could not open the bank window. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

export function PlaidLinkButton({
  itemId,
  accountSelection,
  label = "Connect a bank",
  onUpdated,
  updatedText = "Reconnected.",
  variant = "primary",
}: {
  itemId?: string;
  accountSelection?: boolean;
  label?: string;
  onUpdated?: () => Promise<unknown>;
  updatedText?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "good"; text: string; next?: boolean } | null>(null);

  async function start() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/plaid/link/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(itemId ? { itemId } : {}),
          ...(accountSelection ? { accountSelection: true } : {}),
        }),
      });
      const json = (await res.json()) as { link_token?: string; error?: string };
      if (!res.ok || !json.link_token)
        throw new Shown(
          res.status === 503 && json.error ? json.error : "Could not start the bank connection. Try again.",
        );
      const Plaid = await loadPlaid();
      const handler = Plaid.create({
        token: json.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            if (itemId) {
              const r = (await onUpdated?.()) as { ok?: boolean; error?: string } | undefined;
              if (r && r.ok === false) throw new Shown(explainError({ code: r.error }, "plaid"));
              setMsg({ tone: "good", text: updatedText });
            } else {
              const ex = await fetch("/api/plaid/link/exchange", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  public_token: publicToken,
                  institution: metadata.institution
                    ? { id: metadata.institution.institution_id, name: metadata.institution.name }
                    : null,
                }),
              });
              const out = (await ex.json()) as { accounts?: number; error?: string };
              if (!ex.ok) throw new Shown(out.error ?? "Could not finish connecting the bank. Try again.");
              const n = out.accounts ?? 0;
              const bank = metadata.institution?.name ?? "your bank";
              setMsg({
                tone: "good",
                text: `Linked ${bank}: ${n} ${n === 1 ? "account" : "accounts"}. The first sync is running.`,
                next: true,
              });
            }
            router.refresh();
          } catch (e) {
            setMsg({ tone: "bad", text: e instanceof Shown ? e.message : explainError(e, "plaid") });
          } finally {
            handler.destroy();
            setBusy(false);
          }
        },
        onExit: (err) => {
          if (err?.error_code) setMsg({ tone: "bad", text: explainError(err, "plaid") });
          handler.destroy();
          setBusy(false);
        },
      });
      handler.open();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Shown ? e.message : explainError(e, "plaid") });
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={start} disabled={busy} variant={variant}>
        {busy ? "Opening your bank..." : label}
      </Button>
      <div aria-live="polite">
        {msg ? (
          <Notice tone={msg.tone}>
            {msg.text}
            {msg.next ? (
              <>
                {" "}
                <Link href="/spending" className="font-medium underline">
                  Review your spending next
                </Link>
              </>
            ) : null}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
