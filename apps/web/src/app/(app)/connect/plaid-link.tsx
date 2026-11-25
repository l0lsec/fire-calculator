"use client";
// Opens Plaid Link. New connections exchange the public token on the server;
// update mode (re-authentication, new accounts) only needs a refresh after.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";

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
    onExit: (err: { error_message?: string; display_message?: string | null } | null) => void;
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
    s.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error("Plaid failed to load")));
    s.onerror = () => reject(new Error("Could not load Plaid Link"));
    document.head.appendChild(s);
  });
}

export function PlaidLinkButton({
  itemId,
  accountSelection,
  label = "Connect a bank",
  onUpdated,
  variant = "primary",
}: {
  itemId?: string;
  accountSelection?: boolean;
  label?: string;
  onUpdated?: () => Promise<unknown>;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "good"; text: string } | null>(null);

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
      if (!res.ok || !json.link_token) throw new Error(json.error ?? "Could not start the bank connection.");
      const Plaid = await loadPlaid();
      const handler = Plaid.create({
        token: json.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            if (itemId) {
              await onUpdated?.();
              setMsg({ tone: "good", text: "Reconnected." });
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
              if (!ex.ok) throw new Error(out.error ?? "Could not finish connecting.");
              setMsg({ tone: "good", text: `Connected ${out.accounts ?? 0} accounts.` });
            }
            router.refresh();
          } catch (e) {
            setMsg({ tone: "bad", text: (e as Error).message });
          } finally {
            handler.destroy();
            setBusy(false);
          }
        },
        onExit: (err) => {
          if (err)
            setMsg({
              tone: "bad",
              text: err.display_message ?? err.error_message ?? "Connection cancelled.",
            });
          handler.destroy();
          setBusy(false);
        },
      });
      handler.open();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={start} disabled={busy} variant={variant}>
        {busy ? "Opening..." : label}
      </Button>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}
