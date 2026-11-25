import Link from "next/link";
import { Card } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { plaidConfigured } from "@/server/plaid/config";
import { PlaidLinkButton } from "./plaid-link";

export const metadata = { title: "Connect a bank | FIRE Planner" };

export default async function ConnectPage() {
  await requireContext();
  const ready = plaidConfigured();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Connect a bank</h1>
      <Card>
        <div className="flex flex-col gap-4 text-sm text-ink-2">
          <p>
            Connecting through Plaid pulls balances, card and loan details (rates, minimums, escrow) and 24
            months of transactions, so your spending and debts are measured rather than guessed.
          </p>
          <ul className="list-disc pl-5">
            <li>Your bank login goes to Plaid, never to this app.</li>
            <li>This app stores an encrypted access token and read-only data. It cannot move money.</li>
            <li>You can disconnect, or delete everything, at any time on the Connections page.</li>
          </ul>
          {ready ? (
            <PlaidLinkButton />
          ) : (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
              Bank connections are not configured on this server yet. You can still enter everything by hand
              on the{" "}
              <Link className="underline" href="/accounts">
                Accounts
              </Link>{" "}
              page.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
