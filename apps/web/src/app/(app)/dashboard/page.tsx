import Link from "next/link";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { age, duration, pct, usd, usdCents } from "@/lib/format";
import { dashboardModel, type LadderRow } from "@/server/dashboard";
import { DEBT_KIND_LABELS } from "@/server/debts";
import { planForScenario } from "@/server/snapshot";
import { RateEntry, type RateNeeded } from "./rate-entry";

export const metadata = { title: "Dashboard | FIRE Planner" };

const FIX: Record<string, { href: string; label: string }> = {
  "no-people": { href: "/plan", label: "Add birth month" },
  "no-spending": { href: "/plan", label: "Enter spending" },
  invalid: { href: "/plan", label: "Review plan" },
};

function Ladder({ rows }: { rows: LadderRow[] }) {
  return (
    <ol className="flex flex-col gap-3" data-testid="fi-ladder">
      {rows.map((l) => (
        <li key={l.id} data-testid={`ladder-${l.id}`} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{l.label}</span>
            <span className="text-sm" data-testid={`ladder-${l.id}-when`}>
              {l.status === "reached" ? (
                <span className="font-medium text-accent">Reached</span>
              ) : l.status === "projected" ? (
                <>
                  {l.when} <span className="text-ink-3">(age {age(l.age ?? 0)})</span>
                </>
              ) : (
                <span className="text-ink-3">Not within the plan</span>
              )}
            </span>
          </div>
          {!l.isDebt ? (
            <>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-label={`${l.label} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(l.progress * 100)}
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(l.progress * 100)}%` }}
                />
              </div>
              <p className="num mt-1 text-xs text-ink-3">
                {usd(l.current)} of <span data-testid={`ladder-${l.id}-target`}>{usd(l.target)}</span>
              </p>
            </>
          ) : l.current > 0 ? (
            <p className="num mt-1 text-xs text-ink-3">{usd(l.current)} to go</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const ctx = await requireContext();
  const { scenario } = await searchParams;
  const plan = await planForScenario(ctx, scenario);
  const m = dashboardModel(plan);
  const h = m.headline;
  const debtsById = new Map(plan.data.debts.map((d) => [d.id, d]));
  const ratesNeeded: RateNeeded[] = m.issues.flatMap((i) => {
    const d = i.code === "unknown-apr" && i.ref ? debtsById.get(i.ref) : undefined;
    return d
      ? [{ id: d.id, name: d.name, detail: `${DEBT_KIND_LABELS[d.kind]} · ${usdCents(d.balanceCents)} owed` }]
      : [];
  });
  const otherIssues = m.issues.filter((i) => !(i.code === "unknown-apr" && i.ref && debtsById.has(i.ref)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-ink-3">{m.scenarioName}, in today&apos;s dollars.</p>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Assumptions">
          {m.chips.map((c) => (
            <li key={c.label} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
              {c.label} <span className="font-medium text-ink">{c.value}</span>
            </li>
          ))}
          <li>
            <Link href="/plan" className="rounded-full px-2.5 py-1 text-xs text-accent underline">
              Edit
            </Link>
          </li>
        </ul>
      </div>

      {m.issues.length ? (
        <Card title={m.ready ? "Finish your plan" : "Let's set up your plan"}>
          <div className="flex flex-col gap-4">
            {otherIssues.length ? (
              <ul className="flex flex-col gap-2">
                {otherIssues.map((i) => {
                  const fix = FIX[i.code] ?? { href: "/plan", label: "Open plan" };
                  return (
                    <li
                      key={`${i.code}-${i.ref ?? ""}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>{i.message}</span>
                      <Link className="text-accent underline" href={fix.href}>
                        {fix.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {ratesNeeded.length ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-2">
                  {ratesNeeded.length === 1
                    ? "This debt has no interest rate yet, so it's left out of the plan. Type it in:"
                    : "These debts have no interest rate yet, so they're left out of the plan. Type them in:"}
                </p>
                <RateEntry debts={ratesNeeded} autoFocus={otherIssues.length === 0} />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {h ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs text-ink-3">Your FI number</p>
              <p className="num text-2xl font-semibold" data-testid="fi-target">
                {usd(h.fiTarget)}
              </p>
              <p className="num text-xs text-ink-3">
                {usd(h.spendingPart)} for spending{h.debtPart > 0 ? ` + ${usd(h.debtPart)} of debt` : ""}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">FI date</p>
              <p className="num text-2xl font-semibold" data-testid="fi-when">
                {h.fiWhen ?? "Not within the plan"}
              </p>
              <p className="text-xs text-ink-3">
                {h.fiAge !== null && h.fiMonths !== null
                  ? `age ${age(h.fiAge)}, in ${duration(h.fiMonths)}`
                  : "Raise savings or lower spending"}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">Invested toward FI</p>
              <p className="num text-2xl font-semibold" data-testid="fi-portfolio">
                {usd(h.portfolio)}
              </p>
              <p className="num text-xs text-ink-3">Net worth {usd(h.netWorth)}</p>
            </Card>
            <Card>
              <p className="text-xs text-ink-3">Savings rate</p>
              <p className="num text-2xl font-semibold" data-testid="savings-rate">
                {h.savingsRate === null ? "n/a" : pct(h.savingsRate, 0)}
              </p>
              <p className="num text-xs text-ink-3">
                Spending {usd(h.spendingAnnual)}/yr (
                {h.spendingSource === "plaid" ? "from your accounts" : "your estimate"})
              </p>
            </Card>
          </div>

          {m.warnings
            .filter((w) => !(m.access && w.code === "fi-before-59-5-traditional-heavy"))
            .map((w) => (
              <Notice key={w.code} tone="warn">
                {w.message}
              </Notice>
            ))}
          {m.access ? (
            <Card title="Reaching your money before 59.5">
              <div className="flex flex-col gap-2 text-sm text-ink-2" data-testid="access-warning">
                <p>
                  Your FI date is {age(m.access.gapYears)} years before 59.5, but only{" "}
                  <span className="num font-medium text-ink">{usd(m.access.accessibleAtFI)}</span> is
                  reachable then without penalty (cash, taxable accounts and Roth contributions). That runs
                  out before 59.5.
                </p>
                {m.access.ladderFromYear !== null ? (
                  <p>
                    A Roth conversion ladder started at FI would cover spending from year{" "}
                    {m.access.ladderFromYear}; the first years still need taxable savings or Roth
                    contributions. The Rule of 55 may also apply if you leave your employer at 55 or later.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}
          {Math.abs(m.tax.suggested - m.tax.assumed) > 0.03 ? (
            <Notice tone="info">
              Your account mix suggests about {pct(m.tax.suggested, 0)} tax on withdrawals; the plan assumes{" "}
              {pct(m.tax.assumed, 0)}. You can change it on the Plan page.
            </Notice>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <Card title="Projection">
              <ProjectionChart data={m.chart} />
              <p className="mt-2 text-xs text-ink-3">
                {m.retireLabel
                  ? `The plan stops work in ${m.retireLabel}; after that the portfolio funds your spending.`
                  : "The plan keeps working through the horizon."}{" "}
                Retirement spending: {usd(h.retirementSpending)}/yr.
              </p>
            </Card>
            <Card title="Your FI ladder">
              <Ladder rows={m.ladder} />
            </Card>
          </div>
        </>
      ) : null}
      <Disclaimer />
    </div>
  );
}
