import { ButtonForm } from "@/components/action-form";
import { Card, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { plaidConfigured } from "@/server/plaid/config";
import { itemsForDisplay } from "@/server/plaid/items";
import { PlaidLinkButton } from "../connect/plaid-link";
import { disconnectAction, refreshItemAction } from "./actions";
import { DeleteEverything } from "./delete-everything";
import { UpdateButton } from "./update-button";

export const metadata = { title: "Connections | FIRE Planner" };

const TONE: Record<string, string> = {
  healthy: "text-accent",
  login_required: "text-warn",
  pending_disconnect: "text-warn",
  revoked: "text-bad",
  error: "text-bad",
};

export default async function ConnectionsPage() {
  const ctx = await requireContext();
  const ready = plaidConfigured();
  const items = await itemsForDisplay(ctx);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="text-sm text-ink-3">
            Banks connected through Plaid. Read-only; this app cannot move money.
          </p>
        </div>
        {ready ? <PlaidLinkButton label="Connect another bank" /> : null}
      </div>
      {!ready ? <Notice tone="warn">Bank connections are not configured on this server yet.</Notice> : null}
      {items.length === 0 ? <p className="text-sm text-ink-3">No banks connected.</p> : null}
      {items.map((i) => (
        <Card key={i.id} title={i.institution}>
          <div className="flex flex-col gap-3 text-sm" data-testid={`item-${i.id}`}>
            <p>
              <span className={`font-medium ${TONE[i.status] ?? ""}`} data-testid="item-status">
                {i.statusText}
              </span>
              {i.lastSyncedAt ? (
                <span className="text-ink-3"> · last updated {i.lastSyncedAt.slice(0, 10)}</span>
              ) : null}
              {i.consentExpiresAt ? (
                <span className="text-warn"> · access expires {i.consentExpiresAt.slice(0, 10)}</span>
              ) : null}
            </p>
            {i.needsUpdate ? (
              <Notice tone="warn">
                {i.newAccounts
                  ? "This bank has new accounts you can add."
                  : "Your bank needs you to sign in again before it will share new data."}
              </Notice>
            ) : null}
            <p className="text-ink-3">{i.accounts.join(", ") || "No accounts"}</p>
            <div className="flex flex-wrap items-center gap-2">
              {i.needsUpdate ? <UpdateButton itemId={i.id} newAccounts={i.newAccounts} /> : null}
              <ButtonForm
                action={refreshItemAction}
                label="Refresh now"
                variant="secondary"
                hidden={{ itemId: i.id }}
              />
              <ButtonForm
                action={disconnectAction}
                label="Disconnect"
                variant="ghost"
                confirm={`Disconnect ${i.institution}? Its accounts stay in your history but stop updating.`}
                hidden={{ itemId: i.id }}
              />
            </div>
          </div>
        </Card>
      ))}
      <Card title="Delete everything">
        <p className="mb-3 text-sm text-ink-2">
          Revokes every bank connection at Plaid and permanently deletes all of your household&apos;s data
          from this app. This cannot be undone. A record that a deletion happened (with no personal data) is
          kept.
        </p>
        <DeleteEverything />
      </Card>
    </div>
  );
}
