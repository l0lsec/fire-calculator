import { ButtonForm } from "@/components/action-form";
import { Card, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { iphoneStatus } from "@/server/financekit";
import { plaidConfigured } from "@/server/plaid/config";
import { itemsForDisplay } from "@/server/plaid/items";
import { PlaidLinkButton } from "../connect/plaid-link";
import { disconnectAction, importIphoneAction, refreshItemAction, unpairIphoneAction } from "./actions";
import { DeleteEverything } from "./delete-everything";
import { IphonePair } from "./iphone-pair";
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
  const [items, iphone] = await Promise.all([itemsForDisplay(ctx), iphoneStatus(ctx)]);
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
            <p className="text-xs text-ink-3">
              Missing an account? Choose accounts reopens this bank&apos;s account picker without using
              another connection.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {i.needsUpdate && !i.newAccounts ? (
                <UpdateButton itemId={i.id} mode="reconnect" />
              ) : (
                <UpdateButton itemId={i.id} mode="accounts" />
              )}
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
      <Card title="iPhone: Apple Card, Apple Cash and Savings">
        <div className="flex flex-col gap-3 text-sm" data-testid="iphone-card">
          <p className="text-ink-2">
            Banks cannot share Apple Card through Plaid on a computer. The FIRE Planner Sync iPhone app reads
            them with your permission through Apple Wallet (FinanceKit), encrypts them with a key only this
            Mac and your phone know, and drops them in its iCloud Drive folder. This app picks them up when
            you open it.
          </p>
          {iphone ? (
            <>
              <p data-testid="iphone-status">
                <span className={`font-medium ${iphone.lastError ? "text-bad" : "text-accent"}`}>
                  {iphone.lastError
                    ? "Sync problem"
                    : iphone.lastSnapshotAt
                      ? "Syncing"
                      : "Paired, waiting for the first sync"}
                </span>
                {iphone.deviceName ? <span className="text-ink-3"> · {iphone.deviceName}</span> : null}
                {iphone.lastSnapshotAt ? (
                  <span className="text-ink-3">
                    {" "}
                    · last data from phone {iphone.lastSnapshotAt.slice(0, 16).replace("T", " ")} UTC
                  </span>
                ) : null}
              </p>
              {iphone.lastError ? <Notice tone="bad">{iphone.lastError}</Notice> : null}
              <p className="text-ink-3">{iphone.accounts.join(", ") || "No accounts yet"}</p>
              <div className="flex flex-wrap items-center gap-2">
                <ButtonForm action={importIphoneAction} label="Check for new data" variant="secondary" />
                <ButtonForm
                  action={unpairIphoneAction}
                  label="Unpair"
                  variant="ghost"
                  confirm="Unpair the iPhone? Its accounts stay in your history but stop updating."
                />
              </div>
            </>
          ) : null}
          <IphonePair paired={Boolean(iphone)} />
        </div>
      </Card>
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
