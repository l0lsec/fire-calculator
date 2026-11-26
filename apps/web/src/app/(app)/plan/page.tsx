import { listItems } from "@fire/db";
import { yearMonth } from "@fire/engine/core";
import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { Card, Disclaimer } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { pct, usd, usdCents } from "@/lib/format";
import { loadScenario, readScenario } from "@/server/scenarios";
import { hasConnectedAccounts, loadHousehold, todayISO } from "@/server/snapshot";
import {
  deleteContributionAction,
  deleteIncomeAction,
  deletePersonAction,
  removeAdjustmentAction,
} from "./actions";
import {
  AdjustmentForm,
  AssumptionsForm,
  ContributionForm,
  IncomeForm,
  PersonForm,
  SpendingForm,
} from "./forms";

export const metadata = { title: "Plan | FIRE Planner" };

const num = (x: number) => String(Math.round(x * 10000) / 10000);
const pctIn = (x: number) => num(x * 100);
// Money as people type it: "60,000" or "1,234.50" (the parsers accept commas).
const centsIn = (c: number | null | undefined) =>
  c
    ? (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
    : "";
const birthLabel = (m: number) => {
  const { year, month } = yearMonth(m);
  return `${year}-${String(month).padStart(2, "0")}`;
};
const KIND: Record<string, string> = {
  takeHome: "Take-home pay",
  partTime: "Part-time",
  socialSecurity: "Social Security",
  pension: "Pension",
  other: "Other",
};

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const ctx = await requireContext();
  const { scenario: scenarioId } = await searchParams;
  const [data, row, items] = await Promise.all([
    loadHousehold(ctx, todayISO()),
    loadScenario(ctx, scenarioId),
    listItems(ctx.db, ctx.scope),
  ]);
  const s = readScenario(row);
  const a = s.assumptions;
  const people = data.people.map((p) => ({ id: p.id, name: p.name }));
  const connected = items.length > 0 || hasConnectedAccounts(data);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="text-sm text-ink-3">
          Editing <span className="font-medium text-ink">{s.name}</span>
          {s.isBaseline ? " (your baseline)" : ""}. Each save says how it moved your FI date.
        </p>
      </div>

      <Card title="People">
        <ul className="mb-4 divide-y divide-line">
          {data.people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {p.name} <span className="text-sm text-ink-3">born {birthLabel(p.birthMonth)}</span>
              </span>
              {data.people.length > 1 ? (
                <ButtonForm
                  action={deletePersonAction}
                  label="Remove"
                  hidden={{ id: p.id }}
                  confirm={{
                    title: `Remove ${p.name}?`,
                    body: "Their income and birth month leave the plan, and your FI date is recalculated. This cannot be undone.",
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {data.people.length < 2 ? <PersonForm /> : null}
      </Card>

      <Card title="Spending today">
        {data.spendingSource === "plaid" && data.derivedSpending ? (
          <p className="mb-4 text-sm text-ink-2" data-testid="measured-spending">
            Measured from your connected accounts:{" "}
            <span className="num font-medium text-ink">{usdCents(data.derivedSpending.totalCents)}</span> a
            year, of which escrow {usdCents(data.derivedSpending.escrowCents)}. Your plan uses this.{" "}
            <Link href="/spending" className="text-accent underline">
              Review it
            </Link>
          </p>
        ) : null}
        <SpendingForm
          plaidAvailable={connected}
          v={{
            source: data.spendingSource,
            annual: centsIn(data.spendingProfile?.manualAnnualCents),
            essential: centsIn(data.spendingProfile?.manualEssentialCents),
          }}
        />
        {data.spendingSource === "manual" && connected && data.derivedSpending?.livingCents ? (
          <p className="mt-3 text-sm text-ink-3">
            From your accounts: {usdCents(data.derivedSpending.totalCents)} a year, of which escrow{" "}
            {usdCents(data.derivedSpending.escrowCents)}.
          </p>
        ) : null}
      </Card>

      <Card title="Income">
        {data.income.length ? (
          <ul className="mb-4 divide-y divide-line">
            {data.income.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {i.name}{" "}
                  <span className="text-ink-3">
                    ({KIND[i.kind] ?? i.kind}, {i.phase})
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num">{usdCents(i.monthlyCents)}/mo</span>
                  <ButtonForm
                    action={deleteIncomeAction}
                    label="Remove"
                    hidden={{ id: i.id }}
                    confirm={{
                      title: `Remove ${i.name}?`,
                      body: "This income leaves the plan. This cannot be undone.",
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {people.length ? (
          <IncomeForm people={people} />
        ) : (
          <p className="text-sm text-ink-3">Add a person first.</p>
        )}
      </Card>

      <Card title="Paycheck contributions">
        <p className="mb-3 text-sm text-ink-3">
          Money that goes to retirement accounts before it reaches your bank.
        </p>
        {data.contributions.length ? (
          <ul className="mb-4 divide-y divide-line">
            {data.contributions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {c.name} <span className="text-ink-3">({c.bucket})</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num">{usdCents(c.monthlyCents)}/mo</span>
                  <ButtonForm
                    action={deleteContributionAction}
                    label="Remove"
                    hidden={{ id: c.id }}
                    confirm={{
                      title: `Remove ${c.name}?`,
                      body: "This contribution leaves the plan. This cannot be undone.",
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ContributionForm />
      </Card>

      <Card title="How retirement spending differs from today">
        <p className="mb-3 text-sm text-ink-3">
          Retirement spending is not current spending. Each change is a named line, never a hidden multiplier.
        </p>
        <ul className="mb-4 divide-y divide-line">
          {s.retirementAdjustments.map((adj) => (
            <li key={adj.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {adj.label}
                <span className="text-ink-3">
                  {adj.fromAge !== undefined ? ` from ${adj.fromAge}` : ""}
                  {adj.untilAge !== undefined ? ` until ${adj.untilAge}` : ""}
                  {adj.essential ? ", essential" : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num">{usd(adj.annual)}/yr</span>
                <ButtonForm
                  action={removeAdjustmentAction}
                  label="Remove"
                  hidden={{ scenarioId: s.id, adjustmentId: adj.id }}
                  confirm={{
                    title: `Remove ${adj.label}?`,
                    body: "This line leaves the plan. This cannot be undone.",
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <AdjustmentForm scenarioId={s.id} />
      </Card>

      <Card title="Assumptions">
        <p className="mb-4 text-sm text-ink-3">
          Return {pct(a.nominalReturn)} and inflation {pct(a.inflation)} imply a real return of about{" "}
          {pct((1 + a.nominalReturn) / (1 + a.inflation) - 1, 1)}.
        </p>
        <AssumptionsForm
          v={{
            scenarioId: s.id,
            nominalReturn: pctIn(a.nominalReturn),
            inflation: pctIn(a.inflation),
            cashReturn: pctIn(a.cashReturn),
            raiseRate: pctIn(a.raiseRate),
            swr: pctIn(a.swr),
            retirementAge: num(a.retirementAge),
            lifeExpectancy: num(a.lifeExpectancy),
            emergencyMonths: num(a.emergencyMonths),
            fatMultiplier: num(a.fatMultiplier),
            withdrawalTaxRate: pctIn(a.withdrawalTaxRate),
            retireMode: a.retireAt.mode,
            retireAge: a.retireAt.mode === "age" ? num(a.retireAt.age) : "",
            partTimeAnnual: a.partTime ? a.partTime.annualNet.toFixed(2) : "",
            partTimeHealth: a.partTime ? a.partTime.healthAnnual.toFixed(2) : "",
            partTimeUntil: a.partTime?.untilAge !== undefined ? num(a.partTime.untilAge) : "",
            countGuaranteedIncome: a.countGuaranteedIncome,
            policy: s.policy,
            strategy: s.debtPlan.strategy,
            extraMonthly: s.debtPlan.extraMonthly.toFixed(2),
            hybridThreshold: pctIn(s.debtPlan.hybridThreshold),
          }}
        />
      </Card>
      <Disclaimer />
    </div>
  );
}
