"use client";
// Shows the one-time pairing code for the FIRE Planner Sync iPhone app.
import { useActionState, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { pairIphoneAction } from "./actions";

export function IphonePair({ paired }: { paired: boolean }) {
  const [state, action, pending] = useActionState(pairIphoneAction, null);
  const [copied, setCopied] = useState(false);
  const code = state?.ok ? state.data?.code : undefined;
  return (
    <div className="flex flex-col gap-3">
      <form
        action={action}
        onSubmit={(e) => {
          if (
            paired &&
            !window.confirm(
              "Pair again? The current iPhone stops syncing until you paste the new code into it.",
            )
          )
            e.preventDefault();
        }}
      >
        <Button type="submit" variant={paired ? "secondary" : "primary"} disabled={pending}>
          {pending ? "Creating code..." : paired ? "Pair again" : "Pair iPhone"}
        </Button>
      </form>
      {state && !state.ok && state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {code ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-sm">
            Copy this code, then on your iPhone open <strong>FIRE Planner Sync</strong> and tap{" "}
            <strong>Paste pairing code</strong>. With Universal Clipboard (same Apple Account, Wi-Fi and
            Bluetooth on), what you copy here pastes on the phone.
          </p>
          <code className="break-all rounded bg-bg p-2 text-xs" data-testid="pairing-code">
            {code}
          </code>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <span className="text-xs text-ink-3">
              Shown once. It is the key that encrypts what the phone sends; keep it private.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
