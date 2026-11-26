import { getSpendingProfile } from "@fire/db";
import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { usdCents } from "@/lib/format";
import { effectiveSpendingSource, todayISO } from "@/server/snapshot";
import { categoryLabel, FLAG_TEXT, spendingView } from "@/server/spending";
import { accountBusinessAction, categoryEssentialAction, decideAction, useMeasuredAction } from "./actions";

export const metadata = { title: "Spending | FIRE Planner" };

export default async function SpendingPage() {
  const ctx = await requireContext();
  const [{ s, byAccount, connected }, profile] = await Promise.all([
    spendingView(ctx, todayISO()),
    getSpendingProfile(ctx.db, ctx.scope),
  ]);
  const usingMeasured = effectiveSpendingSource(profile, s) === "plaid";
  const hasEstimate = (profile?.manualAnnualCents ?? 0) > 0;
  const queue = s.reviewQueue.slice(0, 40);

  if (!connected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Spending</h1>
        <Card>
          <p className="text-sm text-ink-2">
            Connect a bank to measure what you really spend. Until then the plan uses the estimate on the{" "}
            <Link href="/plan" className="text-accent underline">
              Plan
            </Link>{" "}
            page.
          </p>
          <Link
            href="/connect"
            className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm text-accent-ink"
          >
            Connect a bank
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Spending</h1>
        <p className="text-sm text-ink-3">
          {s.windowStart} to {s.windowEnd}. Money moved between your own accounts, payments to cards you have
          connected, loan payments and investing are left out; mortgage escrow is included.
        </p>
      </div>
      {s.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-ink-3">Annual spending</p>
          <p className="num text-2xl font-semibold" data-testid="spending-total">
            {usdCents(s.totalCents)}
          </p>
          <p className="num text-xs text-ink-3">includes escrow {usdCents(s.escrowCents)}</p>
          {s.businessCents !== 0 ? (
            <p className="num text-xs text-ink-3" data-testid="spending-business">
              business {usdCents(s.businessCents)} · personal {usdCents(s.totalCents - s.businessCents)}
            </p>
          ) : null}
        </Card>
        <Card>
          <p className="text-xs text-ink-3">Essentials</p>
          <p className="num text-2xl font-semibold" data-testid="spending-essential">
            {usdCents(s.essentialCents)}
          </p>
          <p className="text-xs text-ink-3">sets your Lean FI number</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-3">Discretionary</p>
          <p className="num text-2xl font-semibold">{usdCents(s.discretionaryCents)}</p>
          <p className="text-xs text-ink-3">{queue.length} items to review</p>
        </Card>
      </div>

      <Card title="Plan basis">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>
            {usingMeasured
              ? "Your plan uses this measured spending."
              : "Your plan uses your own estimate. Switch to this measured figure?"}
          </p>
          {usingMeasured && !hasEstimate ? (
            <Link href="/plan" className="text-accent underline">
              Enter my own estimate instead
            </Link>
          ) : (
            <ButtonForm
              action={useMeasuredAction}
              label={usingMeasured ? "Use my estimate instead" : "Use as my retirement baseline"}
              variant={usingMeasured ? "ghost" : "primary"}
              hidden={{ use: usingMeasured ? "false" : "true" }}
            />
          )}
        </div>
      </Card>

      {queue.length ? (
        <Card title="Review">
          <ul className="divide-y divide-line" data-testid="review-queue">
            {queue.map((r) => (
              <li
                key={`${r.transactionId}-${r.flag}`}
                className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {r.name}{" "}
                    <span className="num text-ink-3">{usdCents(r.amountCents, { cents: true })}</span>
                  </p>
                  <p className="text-xs text-ink-3">
                    {r.date} · {FLAG_TEXT[r.flag] ?? r.flag}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.flag === "one-time-candidate" ? (
                    <>
                      <ButtonForm
                        action={decideAction}
                        label="One-time"
                        variant="secondary"
                        hidden={{ decision: "one-time", transactionId: r.transactionId }}
                      />
                      <ButtonForm
                        action={decideAction}
                        label="Spread over 5 yrs"
                        variant="ghost"
                        hidden={{ decision: "amortize", years: "5", transactionId: r.transactionId }}
                      />
                      <ButtonForm
                        action={decideAction}
                        label="Recurring"
                        variant="ghost"
                        hidden={{ decision: "recurring", transactionId: r.transactionId }}
                      />
                    </>
                  ) : r.flag === "possible-spending" ? (
                    <>
                      <ButtonForm
                        action={decideAction}
                        label="It's spending"
                        variant="secondary"
                        hidden={{
                          decision: "class",
                          class: "living_expense",
                          transactionId: r.transactionId,
                        }}
                      />
                      <ButtonForm
                        action={decideAction}
                        label="Not spending"
                        variant="ghost"
                        hidden={{ decision: "class", class: "transfer", transactionId: r.transactionId }}
                      />
                    </>
                  ) : (
                    <>
                      <ButtonForm
                        action={decideAction}
                        label="Keep as spending"
                        variant="secondary"
                        hidden={{
                          decision: "class",
                          class: "living_expense",
                          transactionId: r.transactionId,
                        }}
                      />
                      <ButtonForm
                        action={decideAction}
                        label="Not spending"
                        variant="ghost"
                        hidden={{ decision: "class", class: "transfer", transactionId: r.transactionId }}
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {byAccount.length ? (
        <Card title="By account">
          <p className="mb-2 text-sm text-ink-3">
            Mark the accounts your business pays from. Their spending stays in your totals and is shown on its
            own line, so you can see what is business and what is personal.
          </p>
          <ul className="divide-y divide-line" data-testid="spending-accounts">
            {byAccount.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  {a.name} {a.mask ? <span className="text-ink-3">...{a.mask}</span> : null}{" "}
                  {a.business ? <span className="text-xs text-accent">business</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num">{usdCents(a.livingCents)}/yr</span>
                  <ButtonForm
                    action={accountBusinessAction}
                    label={a.business ? "Mark as personal" : "Mark as business"}
                    hidden={{ id: a.id, business: a.business ? "false" : "true" }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="By category">
        <ul className="divide-y divide-line">
          {s.byCategory.map((c) => (
            <li key={c.category} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {categoryLabel(c.category)}{" "}
                <span className={`text-xs ${c.essential ? "text-accent" : "text-ink-3"}`}>
                  {c.essential ? "essential" : "discretionary"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num">{usdCents(c.totalCents)}</span>
                {/^[A-Z_]+$/.test(c.category) ? (
                  <ButtonForm
                    action={categoryEssentialAction}
                    label={c.essential ? "Mark discretionary" : "Mark essential"}
                    hidden={{ category: c.category, essential: c.essential ? "false" : "true" }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Disclaimer />
    </div>
  );
}
