import Link from "next/link";
import { ButtonForm } from "@/components/action-form";
import { ValueBars } from "@/components/charts/value-bars";
import { Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { scenarioBars } from "@/lib/chart-data";
import { duration, monthName, pct, usd } from "@/lib/format";
import { COMPARE_LEVELS, type CompareLevel, compareScenarios, investVsPrepay } from "@/server/compare";
import { allScenarios } from "@/server/scenarios";
import { planForScenario } from "@/server/snapshot";
import { deleteScenarioAction } from "./actions";
import { NewWhatIf } from "./forms";

export const metadata = { title: "Scenarios | FIRE Planner" };

const LABEL: Record<CompareLevel, string> = {
  coast: "Coast FI",
  lean: "Lean FI",
  barista: "Barista FI",
  fi: "FI",
  fat: "Fat FI",
  consumerDebtFree: "Consumer debt free",
  debtFree: "Fully debt free",
};

const signedMonths = (d: number | null) =>
  d === null ? "" : d === 0 ? "same" : `${d > 0 ? "+" : "-"}${duration(Math.abs(d))}`;

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; extra?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const list = await allScenarios(ctx);
  const baseline = list.find((s) => s.isBaseline) ?? list[0]!;
  const chosen = (
    sp.ids ? sp.ids.split(",") : [baseline.id, ...list.filter((s) => !s.isBaseline).map((s) => s.id)]
  ).slice(0, 4);
  const cmp = await compareScenarios(ctx, chosen);
  const base = await planForScenario(ctx, baseline.id);
  const extra = Math.max(0, Math.min(100_000, Number(sp.extra ?? 500) || 500));
  const bars = scenarioBars(cmp.summaries);
  const prepay = base.input ? base.input.debts.map((d) => investVsPrepay(base.input!, d.id, extra)) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scenarios</h1>
          <p className="text-sm text-ink-3">
            Compare up to four plans side by side. Dates come from keeping your current path.
          </p>
        </div>
      </div>

      <Card title="Your scenarios">
        <ul className="mb-4 divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                {s.name} {s.isBaseline ? <span className="text-xs text-accent">baseline</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <Link className="text-accent underline" href={`/plan?scenario=${s.id}`}>
                  Edit
                </Link>
                <Link className="text-accent underline" href={`/dashboard?scenario=${s.id}`}>
                  Dashboard
                </Link>
                {!s.isBaseline ? (
                  <ButtonForm
                    action={deleteScenarioAction}
                    label="Delete"
                    confirm={{
                      title: `Delete ${s.name}?`,
                      body: "Its assumptions and spending lines are removed. Your baseline plan is not affected. This cannot be undone.",
                    }}
                    doneMessage={`Deleted ${s.name}.`}
                    hidden={{ id: s.id }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <NewWhatIf from={baseline.id} />
      </Card>

      {bars.fiDate.length + bars.fiNumber.length > 0 && cmp.summaries.length > 1 ? (
        <Card title="FI date and FI number">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Years until FI</h3>
              {bars.fiDate.length ? (
                <ValueBars
                  bars={bars.fiDate}
                  label="Years until FI by scenario, with the month each reaches it"
                  valueLabel="Reaches FI"
                  testId="scenario-fi-date-chart"
                />
              ) : (
                <p className="text-sm text-ink-3">No scenario reaches FI within its plan.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">FI number</h3>
              <ValueBars
                bars={bars.fiNumber.map((b) => ({ ...b, text: usd(b.value) }))}
                label="FI number by scenario"
                valueLabel="FI number"
                color="var(--chart-2)"
                testId="scenario-fi-number-chart"
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            Shorter bars on the left reach FI sooner; shorter bars on the right need less invested.
            {bars.missing.length
              ? ` Not shown: ${bars.missing.map((m) => `${m.name} (${m.reason})`).join(", ")}.`
              : ""}
          </p>
        </Card>
      ) : null}

      <Card title="Side by side">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard */}
        <section className="overflow-x-auto" aria-label="Scenario comparison" tabIndex={0}>
          <table className="w-full min-w-[560px] text-sm" data-testid="compare-table">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 font-medium">Milestone</th>
                {cmp.summaries.map((s) => (
                  <th key={s.id} className="py-2 font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_LEVELS.map((l) => (
                <tr key={l} className="border-b border-line">
                  <td className="py-2">{LABEL[l]}</td>
                  {cmp.summaries.map((s, i) => {
                    const m = s.months[l];
                    const d = i > 0 ? (cmp.deltas[i - 1]?.months[l] ?? null) : null;
                    return (
                      <td key={s.id} className="num py-2">
                        {!s.ready
                          ? "set up"
                          : m === null
                            ? "not within plan"
                            : m === 0
                              ? "reached"
                              : monthName((s.startMonth ?? 0) + m)}
                        {i > 0 && d !== null ? (
                          <span className="ml-1 text-xs text-ink-3">({signedMonths(d)})</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-b border-line">
                <td className="py-2">FI number</td>
                {cmp.summaries.map((s) => (
                  <td key={s.id} className="num py-2">
                    {s.fiTarget === null ? "" : usd(s.fiTarget)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-line">
                <td className="py-2">Debt interest</td>
                {cmp.summaries.map((s) => (
                  <td key={s.id} className="num py-2">
                    {s.totalInterest === null ? "" : usd(s.totalInterest)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-line">
                <td className="py-2">Retirement success (history since 1871)</td>
                {cmp.summaries.map((s) => (
                  <td key={s.id} className="num py-2" data-testid="historical-success">
                    {s.historicalSuccess === null
                      ? ""
                      : `${pct(s.historicalSuccess, 0)} of ${s.historicalStarts} start years`}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2">Retirement success (simulated)</td>
                {cmp.summaries.map((s) => (
                  <td key={s.id} className="num py-2" data-testid="success-rate">
                    {s.successRate === null ? "" : pct(s.successRate, 0)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
        <p className="mt-2 text-xs text-ink-3">
          Success is the share of 200 simulated market paths (15% yearly volatility around your return
          assumption) in which the money lasts, retiring at each plan&apos;s FI date.
        </p>
      </Card>

      {prepay.length ? (
        <Card title={`Invest or prepay? ${usd(extra)} a month`}>
          <p className="mb-3 text-sm text-ink-2">
            The same {usd(extra)} a month either goes to one debt first or stays invested. A paid-off debt is
            a guaranteed return at its rate; investing is an expected return at yours. This shows the
            trade-off; it does not choose.
          </p>
          <ul className="divide-y divide-line text-sm">
            {prepay.map((p) => {
              const d = base.input!.debts.find((x) => x.id === p.debtId)!;
              return (
                <li key={p.debtId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {d.name} <span className="text-ink-3">at {pct(p.apr)}</span>
                  </span>
                  <span className="num">
                    {p.fiMonthsSaved === null
                      ? "FI not within the plan either way"
                      : p.fiMonthsSaved > 0
                        ? `prepaying reaches FI ${duration(p.fiMonthsSaved)} sooner`
                        : p.fiMonthsSaved < 0
                          ? `investing reaches FI ${duration(-p.fiMonthsSaved)} sooner`
                          : "same FI date either way"}
                  </span>
                </li>
              );
            })}
          </ul>
          <form className="mt-3 flex items-end gap-2 text-sm" method="get">
            <input type="hidden" name="ids" value={chosen.join(",")} />
            <label className="flex flex-col gap-1">
              <span>Monthly amount</span>
              <input
                name="extra"
                defaultValue={extra}
                inputMode="decimal"
                className="min-h-10 w-32 rounded-lg border border-line bg-surface px-3"
              />
            </label>
            <button type="submit" className="min-h-10 rounded-lg border border-line px-3">
              Update
            </button>
          </form>
        </Card>
      ) : null}
      {cmp.summaries.some((s) => !s.ready) ? (
        <Notice tone="warn">Some scenarios need setup before they can be compared.</Notice>
      ) : null}
      <Disclaimer />
    </div>
  );
}
