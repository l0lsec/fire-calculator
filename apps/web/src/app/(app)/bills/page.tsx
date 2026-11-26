import { expectedCents, type RecurringSeries } from "@fire/spending";
import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { Card, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { dateText, usdCents } from "@/lib/format";
import { categoryName, loadInsights } from "@/server/insights";
import { hideRecurringAction } from "./actions";

export const metadata = { title: "Bills and subscriptions | FIRE Planner" };

const CADENCE: Record<string, string> = {
  weekly: "every week",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
};

/** At a 4% withdrawal rate, each dollar of yearly spending needs $25 invested. */
const FI_MULTIPLE = 25;

function Row({ s, hidden = false }: { s: RecurringSeries; hidden?: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="recurring-row">
      <div className="min-w-0">
        <p className="font-medium">
          {s.name}
          {s.isNew && s.active ? (
            <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs text-accent">new</span>
          ) : null}
          {s.priceChangeCents > 0 ? (
            <span className="ml-2 rounded bg-warn-soft px-1.5 text-xs text-warn">
              up {usdCents(s.priceChangeCents, { cents: true })}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-ink-3">
          {s.variable ? "about " : ""}
          {usdCents(expectedCents(s), { cents: true })} {CADENCE[s.cadence]} · {categoryName(s.primary)} ·{" "}
          {s.active ? `next ${dateText(s.nextDate)}` : `last ${dateText(s.lastDate)}`}
          {s.confidence === "likely" ? " · seen twice so far" : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums">{usdCents(s.monthlyCents, { cents: true })}/mo</span>
        <ButtonForm
          action={hideRecurringAction}
          label={hidden ? "Show" : "Not recurring"}
          undo={hideRecurringAction}
          hidden={{ key: s.key, hide: hidden ? "false" : "true" }}
        />
      </div>
    </li>
  );
}

function List({ items, empty }: { items: RecurringSeries[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((s) => (
        <Row key={s.key} s={s} />
      ))}
    </ul>
  );
}

export default async function BillsPage() {
  const ctx = await requireContext();
  const { recurring: r, connected } = await loadInsights(ctx);
  const subsYear = r.subscriptionMonthlyCents * 12;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bills and subscriptions</h1>
        <p className="text-sm text-ink-3">
          Found in your transactions: charges from the same merchant on a steady schedule. Loan and card
          payments are on the{" "}
          <Link href="/debts" className="text-accent underline">
            Debts
          </Link>{" "}
          page.
        </p>
      </div>
      {!connected ? (
        <Notice>
          <Link href="/connect" className="font-medium underline">
            Connect a bank
          </Link>{" "}
          to find your subscriptions and bills.
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Subscriptions">
          <p className="text-2xl font-semibold tabular-nums" data-testid="subs-monthly">
            {usdCents(r.subscriptionMonthlyCents)}/mo
          </p>
          <p className="text-sm text-ink-3">{usdCents(subsYear)} a year</p>
        </Card>
        <Card title="Bills">
          <p className="text-2xl font-semibold tabular-nums">{usdCents(r.billMonthlyCents)}/mo</p>
          <p className="text-sm text-ink-3">{usdCents(r.billMonthlyCents * 12)} a year</p>
        </Card>
        <Card title="Effect on your FI number">
          <p className="text-2xl font-semibold tabular-nums">
            {usdCents(subsYear * FI_MULTIPLE, { compact: true })}
          </p>
          <p className="text-sm text-ink-3">
            invested to cover your subscriptions forever at a 4% withdrawal rate. Each $10 a month you cut
            lowers your target by $3,000.
          </p>
        </Card>
      </div>

      <Card title="Coming up in the next 14 days">
        {r.upcoming.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing expected.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {r.upcoming.map((s) => (
              <li key={s.key} className="flex justify-between gap-3 py-2">
                <span>
                  <span className="tabular-nums text-ink-3">{dateText(s.nextDate)}</span> {s.name}
                </span>
                <span className="tabular-nums">
                  {s.variable ? "about " : ""}
                  {usdCents(expectedCents(s), { cents: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Subscriptions (${r.subscriptions.length})`}>
        <List items={r.subscriptions} empty="No subscriptions found yet." />
      </Card>
      <Card title={`Bills (${r.bills.length})`}>
        <List items={r.bills} empty="No recurring bills found yet." />
      </Card>
      {r.inactive.length > 0 ? (
        <Card title="Stopped">
          <p className="mb-2 text-sm text-ink-3">
            Recurring charges that have not appeared for over 1.5 cycles.
          </p>
          <List items={r.inactive} empty="" />
        </Card>
      ) : null}
      {r.hidden.length > 0 ? (
        <Card title="Marked not recurring">
          <ul className="divide-y divide-line">
            {r.hidden.map((s) => (
              <Row key={s.key} s={s} hidden />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
