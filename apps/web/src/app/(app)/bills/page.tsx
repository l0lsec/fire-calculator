import { expectedCents, type RecurringSeries } from "@fire/spending";
import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { DrillTiles } from "@/components/breakdown";
import { ChargeList } from "@/components/charges";
import { Card, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import type { Charge } from "@/lib/charges";
import { dateText, usdCents } from "@/lib/format";
import { categoryName, loadInsights } from "@/server/insights";
import { billsBreakdowns, type ChargesOf, FI_MULTIPLE, monthlyMath } from "@/server/insights/breakdowns";
import { hideRecurringAction } from "./actions";

export const metadata = { title: "Bills and subscriptions | FIRE Planner" };

const CADENCE: Record<string, string> = {
  weekly: "every week",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
};

/** The charges a series was found from, with how they make its monthly figure. */
function SeriesCharges({ s, charges }: { s: RecurringSeries; charges: Charge[] }) {
  return (
    <ChargeList
      charges={charges}
      testId="series-charges"
      explain={
        <>
          Per month: {monthlyMath(s)}.{s.variable ? " The amount varies, so the next charge may differ." : ""}{" "}
          Next expected {dateText(s.nextDate)}.
        </>
      }
    />
  );
}

function Row({
  s,
  chargesOf,
  hidden = false,
}: {
  s: RecurringSeries;
  chargesOf: ChargesOf;
  hidden?: boolean;
}) {
  return (
    <li className="flex flex-col gap-1 py-2" data-testid="recurring-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
      </div>
      <SeriesCharges s={s} charges={chargesOf(s)} />
    </li>
  );
}

function List({
  items,
  empty,
  chargesOf,
}: {
  items: RecurringSeries[];
  empty: string;
  chargesOf: ChargesOf;
}) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((s) => (
        <Row key={s.key} s={s} chargesOf={chargesOf} />
      ))}
    </ul>
  );
}

export default async function BillsPage() {
  const ctx = await requireContext();
  const { recurring: r, connected, charges } = await loadInsights(ctx);
  const chargesOf: ChargesOf = (s) => charges.byIds(s.transactionIds);
  const b = billsBreakdowns(r, chargesOf);
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

      <DrillTiles
        className="sm:grid-cols-3"
        tiles={[
          {
            id: "subscriptions",
            label: "Subscriptions",
            testId: "subs-monthly",
            figure: `${usdCents(r.subscriptionMonthlyCents)}/mo`,
            sub: `${usdCents(subsYear)} a year`,
            breakdown: b.subscriptions,
          },
          {
            id: "bills",
            label: "Bills",
            testId: "bills-monthly",
            figure: `${usdCents(r.billMonthlyCents)}/mo`,
            sub: `${usdCents(r.billMonthlyCents * 12)} a year`,
            breakdown: b.bills,
          },
          {
            id: "fi-effect",
            label: "Effect on your FI number",
            testId: "subs-fi-effect",
            figure: usdCents(subsYear * FI_MULTIPLE, { compact: true }),
            sub: "invested to cover your subscriptions forever at a 4% withdrawal rate",
            breakdown: b["fi-effect"],
          },
        ]}
      />

      <Card title="Coming up in the next 14 days">
        {r.upcoming.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing expected.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {r.upcoming.map((s) => (
              <li key={s.key} className="flex flex-col gap-1 py-2">
                <div className="flex justify-between gap-3">
                  <span>
                    <span className="tabular-nums text-ink-3">{dateText(s.nextDate)}</span> {s.name}
                  </span>
                  <span className="tabular-nums">
                    {s.variable ? "about " : ""}
                    {usdCents(expectedCents(s), { cents: true })}
                  </span>
                </div>
                <SeriesCharges s={s} charges={chargesOf(s)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="subscription-list" title={`Subscriptions (${r.subscriptions.length})`}>
        <List items={r.subscriptions} empty="No subscriptions found yet." chargesOf={chargesOf} />
      </Card>
      <Card id="bill-list" title={`Bills (${r.bills.length})`}>
        <List items={r.bills} empty="No recurring bills found yet." chargesOf={chargesOf} />
      </Card>
      {r.inactive.length > 0 ? (
        <Card title="Stopped">
          <p className="mb-2 text-sm text-ink-3">
            Recurring charges that have not appeared for over 1.5 cycles.
          </p>
          <List items={r.inactive} empty="" chargesOf={chargesOf} />
        </Card>
      ) : null}
      {r.hidden.length > 0 ? (
        <Card title="Marked not recurring">
          <ul className="divide-y divide-line">
            {r.hidden.map((s) => (
              <Row key={s.key} s={s} chargesOf={chargesOf} hidden />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
