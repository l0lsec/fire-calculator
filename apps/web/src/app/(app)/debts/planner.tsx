"use client";
// The debt planner runs the engine in the browser: moving the slider never
// touches the network.
import type { Debt, Strategy } from "@fire/engine/core";
import { compareStrategies, simulateDebts } from "@fire/engine/debt";
import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { duration, monthName, usd } from "@/lib/format";
import { saveDebtPlanAction } from "./actions";
import { PayoffChart } from "./payoff-chart";

const LABEL: Record<Strategy, string> = {
  avalanche: "Avalanche (highest rate first)",
  snowball: "Snowball (smallest balance first)",
  hybrid: "Hybrid (only high-interest debts)",
  custom: "Custom order",
  minimum: "Minimum payments only",
};

const SHORT: Record<Strategy, string> = {
  avalanche: "avalanche",
  snowball: "snowball",
  hybrid: "hybrid",
  custom: "custom order",
  minimum: "minimums only",
};

type Results = ReturnType<typeof compareStrategies>["results"];

/** The strategy that repays everything for the least interest, and why, in one sentence. */
function recommend(results: Results): { strategy: Strategy; reason: string } | null {
  const options = (["avalanche", "snowball", "hybrid"] as Strategy[]).filter((s) => results[s].paidOff);
  if (options.length === 0) return null;
  const pick = options.reduce((a, b) => (results[b].totalInterest < results[a].totalInterest - 0.5 ? b : a));
  const r = results[pick];
  const snow = results.snowball;
  const saved = snow.paidOff ? snow.totalInterest - r.totalInterest : 0;
  const firstGone = (x: Results[Strategy]) =>
    x.payoffOrder[0] ? (x.payoffMonth[x.payoffOrder[0]] ?? null) : null;
  const snowFirst = firstGone(snow);
  const pickFirst = firstGone(r);
  let reason =
    pick === "snowball" || saved < 1
      ? `Paying the smallest balance first costs no more interest here, and clears a debt soonest.`
      : `It saves ${usd(saved)} in interest compared with snowball.`;
  if (pick !== "snowball" && snowFirst !== null && pickFirst !== null && snowFirst < pickFirst)
    reason += ` Snowball clears your first debt ${pickFirst - snowFirst} months sooner, if quick wins help you stick with it.`;
  return { strategy: pick, reason };
}

export function DebtPlanner({
  debts,
  startMonth,
  scenarioId,
  initial,
}: {
  debts: Debt[];
  startMonth: number;
  scenarioId: string;
  initial: { strategy: Strategy; extraMonthly: number; hybridThreshold: number; customOrder: string[] };
}) {
  const [strategy, setStrategy] = useState<Strategy>(initial.strategy);
  const [extra, setExtra] = useState(initial.extraMonthly);
  const plan = useMemo(
    () => ({
      strategy,
      extraMonthly: extra,
      customOrder: initial.customOrder,
      hybridThreshold: initial.hybridThreshold,
    }),
    [strategy, extra, initial.customOrder, initial.hybridThreshold],
  );
  const result = useMemo(() => simulateDebts(debts, plan, { startMonth }), [debts, plan, startMonth]);
  const comparison = useMemo(() => compareStrategies(debts, plan, { startMonth }), [debts, plan, startMonth]);
  const maxExtra = Math.max(2000, Math.ceil((result.budget * 2) / 100) * 100);
  const best = recommend(comparison.results);

  if (debts.length === 0) return <p className="text-sm text-ink-3">No debts with a known rate to plan.</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-ink-3">Debt-free</p>
          <p className="num text-xl font-semibold" data-testid="debt-free-date">
            {result.paidOff ? monthName(startMonth + result.months) : "Not within 50 years"}
          </p>
          <p className="text-xs text-ink-3">
            {result.paidOff ? `in ${duration(result.months)}` : "Payments do not cover interest"}
          </p>
        </div>
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-ink-3">Total interest</p>
          <p className="num text-xl font-semibold" data-testid="total-interest">
            {usd(result.totalInterest)}
          </p>
          <p className="text-xs text-ink-3">saves {usd(comparison.interestSaved[strategy])} vs minimums</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-ink-3">Monthly debt budget</p>
          <p className="num text-xl font-semibold">
            {usd(strategy === "minimum" ? (result.schedule[0]?.totalPayment ?? 0) : result.budget)}
          </p>
          <p className="text-xs text-ink-3">minimums plus {usd(extra)} extra</p>
        </div>
      </div>

      {best ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm"
          data-testid="strategy-recommendation"
        >
          <p>
            <span className="font-semibold">Costs least: {SHORT[best.strategy]}.</span> {best.reason}
          </p>
          {best.strategy !== strategy ? (
            <button
              type="button"
              onClick={() => setStrategy(best.strategy)}
              className="min-h-10 rounded-lg bg-accent px-4 font-medium text-accent-ink hover:opacity-90 pointer-coarse:min-h-11"
            >
              Try {SHORT[best.strategy]}
            </button>
          ) : (
            <span className="text-xs font-medium text-accent">Selected</span>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Strategy</span>
          <select
            className="min-h-10 rounded-lg border border-line bg-surface px-3"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            data-testid="strategy-select"
          >
            {(Object.keys(LABEL) as Strategy[]).map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Extra each month: <span className="num">{usd(extra)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={maxExtra}
            step={25}
            value={extra}
            onChange={(e) => setExtra(Number(e.target.value))}
            aria-label="Extra payment per month"
            data-testid="extra-slider"
            className="accent-[var(--accent)]"
          />
        </label>
      </div>

      <PayoffChart result={result} debts={debts} startMonth={startMonth} />

      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard */}
      <section className="overflow-x-auto" aria-label="Strategy comparison" tabIndex={0}>
        <table className="w-full min-w-[520px] text-sm">
          <caption className="mb-2 text-left text-sm font-semibold">
            Compare strategies at {usd(extra)} extra a month
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="py-2 font-medium">Strategy</th>
              <th className="py-2 font-medium">Debt-free in</th>
              <th className="py-2 text-right font-medium">Total interest</th>
              <th className="py-2 text-right font-medium">First debt gone</th>
            </tr>
          </thead>
          <tbody>
            {(["avalanche", "snowball", "hybrid", "minimum"] as Strategy[]).map((s) => {
              const r = comparison.results[s];
              const first = r.payoffOrder[0] ? r.payoffMonth[r.payoffOrder[0]] : null;
              return (
                <tr
                  key={s}
                  className={`border-b border-line ${s === strategy ? "font-medium" : ""}`}
                  data-testid={`strategy-row-${s}`}
                >
                  <td className="py-2">
                    {LABEL[s]}
                    {best?.strategy === s ? (
                      <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs text-accent">
                        costs least
                      </span>
                    ) : null}
                  </td>
                  <td className="num py-2" data-testid={`strategy-months-${s}`}>
                    {r.paidOff ? `${r.months} months` : "not repaid"}
                  </td>
                  <td className="num py-2 text-right" data-testid={`strategy-interest-${s}`}>
                    {usd(r.totalInterest, { cents: true })}
                  </td>
                  <td className="num py-2 text-right">{first ? `${first} months` : "n/a"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">
          The cheapest order is marked. Snowball clears a debt sooner, which some people find easier to stick
          with; the difference in interest is shown so you can choose.
        </p>
      </section>

      <ActionForm
        action={saveDebtPlanAction}
        submitLabel="Use this plan"
        successMessage="Saved to your plan."
        variant="secondary"
      >
        <input type="hidden" name="scenarioId" value={scenarioId} />
        <input type="hidden" name="strategy" value={strategy} />
        <input type="hidden" name="extraMonthly" value={extra.toFixed(2)} />
      </ActionForm>
    </div>
  );
}
