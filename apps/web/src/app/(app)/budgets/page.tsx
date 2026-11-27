import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { DrillTiles } from "@/components/breakdown";
import { ChargeList } from "@/components/charges";
import { Card, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { dateText, usdCents } from "@/lib/format";
import { isLiving } from "@/server/charges";
import { categoryName, loadInsights } from "@/server/insights";
import { budgetBreakdown } from "@/server/insights/breakdowns";
import { saveBudgetAction, suggestBudgetsAction } from "./actions";
import { BudgetInput } from "./budget-input";

export const metadata = { title: "Budgets | FIRE Planner" };

const BAR: Record<string, string> = {
  over: "bg-bad",
  near: "bg-warn",
  under: "bg-accent",
  none: "bg-ink-3",
};

export default async function BudgetsPage() {
  const ctx = await requireContext();
  const { budgets, asOf, connected, charges, typical } = await loadInsights(ctx);
  const ym = asOf.slice(0, 7);
  const primaryOf = (c: { tx: { pfcPrimary: string | null } }) => c.tx.pfcPrimary ?? "UNCATEGORIZED";
  // The same transactions budgetReport counts: posted living spending and refunds this month, full amounts.
  const thisMonth = (category: string) =>
    charges.where((c) => isLiving(c) && c.tx.date.startsWith(ym) && primaryOf(c) === category);
  // The typical month: the category's counted spending over the window, divided by its months.
  const divisor = typical.months > 0 && typical.months < 12 ? typical.months : 12;
  const overYear = (category: string) =>
    typical.charges.where((c) => isLiving(c) && primaryOf(c) === category, { counted: true });
  const month = new Date(`${asOf}T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const budgeted = budgets.filter((b) => b.budgetCents !== null);
  const totalBudget = budgeted.reduce((s, b) => s + (b.budgetCents ?? 0), 0);
  const totalSpent = budgeted.reduce((s, b) => s + b.spentCents, 0);
  const unbudgeted = budgets.filter((b) => b.budgetCents === null && b.averageCents >= 1000).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Budgets</h1>
          <p className="text-sm text-ink-3">
            {month}, as of {dateText(asOf)}. Spending counts the same transactions as the{" "}
            <Link href="/spending" className="text-accent underline">
              Spending
            </Link>{" "}
            page; transfers, card payments and loan payments are left out.
          </p>
        </div>
        {unbudgeted > 0 ? (
          <ButtonForm
            action={suggestBudgetsAction}
            label={`Suggest ${unbudgeted} from my typical month`}
            variant="secondary"
          />
        ) : null}
      </div>
      {!connected ? <Notice>Connect a bank to see spending against your budgets.</Notice> : null}
      {budgeted.length > 0 ? (
        <DrillTiles
          className="sm:grid-cols-1"
          tiles={[
            {
              id: "budget-total",
              label: "Spent this month",
              testId: "budget-total",
              figure: usdCents(totalSpent),
              sub: `of ${usdCents(totalBudget)} budgeted this month`,
              breakdown: budgetBreakdown(budgets, categoryName, thisMonth, month),
            },
          ]}
        />
      ) : null}
      <Card id="by-category" title="By category">
        {budgets.length === 0 ? (
          <p className="text-sm text-ink-3">No spending yet this year.</p>
        ) : (
          <ul className="divide-y divide-line">
            {budgets.map((b) => {
              const cap = b.budgetCents ?? Math.max(b.averageCents, b.spentCents, 1);
              const pct = Math.min(100, Math.round((b.spentCents / cap) * 100));
              const projPct = Math.min(100, Math.round((b.projectedCents / cap) * 100));
              return (
                <li
                  key={b.category}
                  className="flex flex-col gap-2 py-3"
                  data-testid={`budget-${b.category}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{categoryName(b.category)}</span>
                    <span className="text-sm tabular-nums">
                      {usdCents(b.spentCents)}
                      {b.budgetCents !== null ? (
                        <span className="text-ink-3"> of {usdCents(b.budgetCents)}</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="absolute inset-y-0 left-0 bg-line" style={{ width: `${projPct}%` }} />
                    <div
                      className={`absolute inset-y-0 left-0 ${BAR[b.status]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-4">
                    <ChargeList
                      charges={thisMonth(b.category)}
                      testId="budget-month-charges"
                      label={`This month's ${thisMonth(b.category).length} charges`}
                      totalLabel="Spent this month, total"
                    />
                    <ChargeList
                      charges={overYear(b.category)}
                      testId="budget-typical-charges"
                      label="How the typical month is worked out"
                      totalLabel={`Counted from ${dateText(typical.start)} to ${dateText(typical.end)}, total`}
                      explain={
                        <>
                          Typical month: everything counted in this category over the last {divisor} months,
                          divided by {divisor}, is {usdCents(b.averageCents)}. One-time and spread-out charges
                          count at the amount you chose on the Spending page.
                        </>
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                    <span>
                      {b.status === "over"
                        ? `Over by ${usdCents(b.spentCents - (b.budgetCents ?? 0))}`
                        : b.status === "near"
                          ? `On pace for about ${usdCents(b.projectedCents)}`
                          : b.status === "under"
                            ? `${usdCents((b.budgetCents ?? 0) - b.spentCents)} left`
                            : "No budget"}{" "}
                      · typical month {usdCents(b.averageCents)}
                    </span>
                    <BudgetInput
                      category={b.category}
                      label={categoryName(b.category)}
                      current={b.budgetCents}
                      action={saveBudgetAction}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-ink-3">
        Budgets are a guide for this month. Your FI plan keeps using your measured 12-month spending; trimming
        a category shows up there as the months pass.
      </p>
    </div>
  );
}
