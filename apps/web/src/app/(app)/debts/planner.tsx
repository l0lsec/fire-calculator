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

      <div className="overflow-x-auto">
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
                  <td className="py-2">{LABEL[s]}</td>
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
          Avalanche usually costs least; snowball clears a debt sooner, which some people find easier to stick
          with. Both are reasonable; this shows the trade-off rather than choosing for you.
        </p>
      </div>

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
