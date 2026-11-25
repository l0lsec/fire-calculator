"use client";
import { PlaidLinkButton } from "../connect/plaid-link";
import { refreshAfterUpdate } from "./actions";

export function UpdateButton({ itemId, newAccounts }: { itemId: string; newAccounts: boolean }) {
  return (
    <PlaidLinkButton
      itemId={itemId}
      accountSelection={newAccounts}
      label={newAccounts ? "Add new accounts" : "Reconnect"}
      variant="secondary"
      onUpdated={() => refreshAfterUpdate(itemId)}
    />
  );
}
