import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { DrillTiles } from "@/components/breakdown";
import { ButtonLink, Card } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { usdCents } from "@/lib/format";
import { accountsForDisplay } from "@/server/accounts";
import { BUCKET_LABELS, BUCKETS } from "@/server/accounts/labels";
import { accountsBreakdown } from "@/server/dashboard/breakdowns";
import { AccountForm } from "./account-form";
import { deleteAccountAction } from "./actions";

export const metadata = { title: "Accounts | FIRE Planner" };

const dollarsText = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export default async function AccountsPage() {
  const ctx = await requireContext();
  const accounts = await accountsForDisplay(ctx);
  const total = accounts
    .filter((a) => a.includeInFi && a.bucket !== "excluded")
    .reduce((s, a) => s + a.currentCents, 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-ink-3">
            Debts live on the{" "}
            <Link className="text-accent underline" href="/debts">
              Debts
            </Link>{" "}
            page.
          </p>
        </div>
        <ButtonLink href="/connect">Connect a bank</ButtonLink>
      </div>

      <DrillTiles
        tiles={[
          {
            id: "counting",
            label: "Counting toward FI",
            testId: "accounts-counting",
            figure: usdCents(total),
            sub: `${accounts.filter((a) => a.includeInFi && a.bucket !== "excluded").length} of ${accounts.length} accounts`,
            breakdown: accountsBreakdown(accounts),
          },
        ]}
      />

      {BUCKETS.map((bucket) => {
        const rows = accounts.filter((a) => a.bucket === bucket);
        if (rows.length === 0) return null;
        return (
          <Card key={bucket} title={BUCKET_LABELS[bucket]}>
            <ul className="divide-y divide-line">
              {rows.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {a.name} {a.mask ? <span className="text-ink-3">...{a.mask}</span> : null}
                      </p>
                      <p className="text-xs text-ink-3">
                        {a.source === "plaid" ? "Connected" : "Entered by you"}
                        {a.includeInFi ? "" : " · not counted toward FI"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num font-medium">{usdCents(a.currentCents)}</span>
                      {a.source === "manual" ? (
                        <ButtonForm
                          action={deleteAccountAction}
                          label="Delete"
                          confirm={{
                            title: `Delete ${a.name}?`,
                            body: "Its balance leaves your net worth and plan, and its history is removed. This cannot be undone.",
                          }}
                          hidden={{ id: a.id }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="flex min-h-10 cursor-pointer items-center text-sm text-accent pointer-coarse:min-h-11">
                      Edit
                    </summary>
                    <div className="mt-3">
                      <AccountForm
                        v={{
                          id: a.id,
                          name: a.name,
                          bucket: a.bucket,
                          balance: dollarsText(a.currentCents),
                          costBasis: dollarsText(a.costBasisCents),
                          rothBasis: dollarsText(a.rothBasisCents),
                          includeInFi: a.includeInFi,
                          plaid: a.source === "plaid",
                        }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Card title="Add an account by hand">
        <p className="mb-4 text-sm text-ink-3">
          For anything your bank connection cannot see: a pension estimate, a property, an account at an
          unsupported institution.
        </p>
        <AccountForm />
      </Card>
    </div>
  );
}
