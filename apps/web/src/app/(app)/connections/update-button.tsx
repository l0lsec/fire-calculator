"use client";
import { PlaidLinkButton } from "../connect/plaid-link";
import { refreshAfterUpdate } from "./actions";

// "reconnect" repairs a broken login. "accounts" reopens the bank's account
// picker so more (or fewer) accounts can be shared. Both edit the existing
// Item, so neither creates a new Plaid connection.
export function UpdateButton({ itemId, mode }: { itemId: string; mode: "reconnect" | "accounts" }) {
  const accounts = mode === "accounts";
  return (
    <PlaidLinkButton
      itemId={itemId}
      accountSelection={accounts}
      label={accounts ? "Choose accounts" : "Reconnect"}
      updatedText={accounts ? "Accounts updated." : "Reconnected."}
      variant="secondary"
      onUpdated={() => refreshAfterUpdate(itemId)}
    />
  );
}
