import { getSpendingProfile } from "@fire/db";
import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { DrillTiles } from "@/components/breakdown";
import { CategoryTrends } from "@/components/charts/category-trends";
import { StackedBars } from "@/components/charts/stacked-bars";
import { ButtonLink, Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { categoryTrends, spendingSplitByMonth } from "@/lib/chart-data";
import { dateText, usdCents } from "@/lib/format";
import { effectiveSpendingSource, todayISO } from "@/server/snapshot";
import { categoryLabel, FLAG_TEXT, spendingBreakdowns, spendingView } from "@/server/spending";
import {
  accountBusinessAction,
  categoryEssentialAction,
  decideAction,
  undoCategoryEssentialAction,
  undoDecisionAction,
  useMeasuredAction,
} from "./actions";

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
  const breakdowns = spendingBreakdowns(s);
  const months = s.monthly.map((m) => m.month);
  const split = spendingSplitByMonth(s.classified, months);
  const withSpending = s.monthly.filter((m) => m.livingCents !== 0);
  const averageMonth = withSpending.length
    ? withSpending.reduce((v, m) => v + m.livingCents, 0) / withSpending.length / 100
    : 0;
  const trends = categoryTrends(s.classified, months, categoryLabel, 6);

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
          <ButtonLink href="/connect" variant="primary" className="mt-3">
            Connect a bank
          </ButtonLink>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Spending</h1>
        <p className="text-sm text-ink-3">
          {dateText(s.windowStart)} to {dateText(s.windowEnd)}. Money moved between your own accounts,
          payments to cards you have connected, loan payments and investing are left out; mortgage escrow is
          included.
        </p>
      </div>
      {s.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <DrillTiles
        className="sm:grid-cols-3"
        tiles={[
          {
            id: "annual",
            label: "Annual spending",
            testId: "spending-total",
            figure: usdCents(s.totalCents),
            sub: (
              <>
                includes escrow {usdCents(s.escrowCents)}
                {s.businessCents !== 0 ? (
                  <span className="block" data-testid="spending-business">
                    business {usdCents(s.businessCents)} · personal {usdCents(s.totalCents - s.businessCents)}
                  </span>
                ) : null}
              </>
            ),
            breakdown: breakdowns.annual,
          },
          {
            id: "essentials",
            label: "Essentials",
            testId: "spending-essential",
            figure: usdCents(s.essentialCents),
            sub: "sets your Lean FI number",
            breakdown: breakdowns.essentials,
          },
          {
            id: "discretionary",
            label: "Discretionary",
            testId: "spending-discretionary",
            figure: usdCents(s.discretionaryCents),
            sub: queue.length ? `${queue.length} items left to review` : "All items reviewed",
            breakdown: breakdowns.discretionary,
          },
        ]}
      />

      {withSpending.length ? (
        <Card title="Month by month">
          <p className="mb-3 text-sm text-ink-3">
            What you spent each month on living costs, essentials and discretionary apart. Mortgage escrow is
            not in these bars.
          </p>
          <StackedBars
            rows={split.map((m) => ({
              label: m.month,
              essential: m.essential,
              discretionary: m.discretionary,
            }))}
            series={[
              { key: "essential", label: "Essentials", color: "var(--chart-1)" },
              { key: "discretionary", label: "Discretionary", color: "var(--chart-2)" },
            ]}
            label={`Living spending by month, essentials and discretionary; average ${usdCents(averageMonth * 100)} a month`}
            totalLabel="Spent"
            average={{ value: averageMonth, label: "your average month with spending" }}
            testId="spending-monthly"
          />
        </Card>
      ) : null}

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
              doneMessage={
                usingMeasured
                  ? "Your plan now uses your own estimate."
                  : "Your plan now uses measured spending."
              }
              label={usingMeasured ? "Use my estimate instead" : "Use as my retirement baseline"}
              variant={usingMeasured ? "ghost" : "primary"}
              hidden={{ use: usingMeasured ? "false" : "true" }}
            />
          )}
        </div>
      </Card>

      {queue.length ? (
        <Card title={`Review: ${queue.length} left`}>
          <p className="mb-2 text-xs text-ink-3">
            Each choice updates your spending at once and can be undone from the message that appears.
          </p>
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
                    {dateText(r.date)} · {FLAG_TEXT[r.flag] ?? r.flag}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.flag === "one-time-candidate" ? (
                    <>
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="One-time"
                        testId="review-suggested"
                        variant="secondary"
                        hidden={{ decision: "one-time", transactionId: r.transactionId }}
                      />
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="Spread over 5 yrs"
                        variant="ghost"
                        hidden={{ decision: "amortize", years: "5", transactionId: r.transactionId }}
                      />
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="Recurring"
                        variant="ghost"
                        hidden={{ decision: "recurring", transactionId: r.transactionId }}
                      />
                    </>
                  ) : r.flag === "possible-spending" ? (
                    <>
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="It's spending"
                        testId="review-suggested"
                        variant="secondary"
                        hidden={{
                          decision: "class",
                          class: "living_expense",
                          transactionId: r.transactionId,
                        }}
                      />
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="Not spending"
                        variant="ghost"
                        hidden={{ decision: "class", class: "transfer", transactionId: r.transactionId }}
                      />
                    </>
                  ) : (
                    <>
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
                        label="Keep as spending"
                        testId="review-suggested"
                        variant="secondary"
                        hidden={{
                          decision: "class",
                          class: "living_expense",
                          transactionId: r.transactionId,
                        }}
                      />
                      <ButtonForm
                        action={decideAction}
                        undo={undoDecisionAction}
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
                    undo={accountBusinessAction}
                    label={a.business ? "Mark as personal" : "Mark as business"}
                    hidden={{ id: a.id, business: a.business ? "false" : "true" }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {trends.length > 1 ? (
        <Card title="Category trends">
          <CategoryTrends trends={trends} testId="spending-category-trends" />
        </Card>
      ) : null}

      <Card id="by-category" title="By category">
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
                    undo={undoCategoryEssentialAction}
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
