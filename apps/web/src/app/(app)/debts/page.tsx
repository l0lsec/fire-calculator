import { yearMonth } from "@fire/engine/core";
import { ButtonForm } from "@/components/action-form";
import { Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { pct, usdCents } from "@/lib/format";
import { DEBT_KIND_LABELS } from "@/server/debts";
import { planForScenario, toEngineDebts } from "@/server/snapshot";
import { deleteDebtAction } from "./actions";
import { DebtForm } from "./debt-form";
import { DebtPlanner } from "./planner";

export const metadata = { title: "Debts | FIRE Planner" };

const SOURCE: Record<string, string> = {
  plaid: "from your bank",
  user: "entered by you",
  unknown: "rate needed",
};
const dollarsText = (c: number) => (c / 100).toFixed(2);
const monthText = (m: number | null) => {
  if (m === null) return undefined;
  const { year, month } = yearMonth(m);
  return `${year}-${String(month).padStart(2, "0")}`;
};

export default async function DebtsPage() {
  const ctx = await requireContext();
  const plan = await planForScenario(ctx);
  const debts = plan.data.debts;
  const engineDebts = toEngineDebts(debts).debts;
  const [y, m] = plan.asOf.split("-").map(Number) as [number, number];
  const startMonth = plan.input?.startMonth ?? y * 12 + (m - 1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Debts</h1>
        <p className="text-sm text-ink-3">
          Every balance still owed when you reach FI is added to your FI target.
        </p>
      </div>

      {plan.issues
        .filter((i) => i.code === "unknown-apr")
        .map((i) => (
          <Notice key={i.ref} tone="warn">
            {i.message} Without it this debt is left out of the plan rather than treated as interest-free.
          </Notice>
        ))}

      <Card title="Your debts">
        {debts.length === 0 ? (
          <p className="text-sm text-ink-3">No debts. Add one below, or connect a bank.</p>
        ) : null}
        <ul className="divide-y divide-line">
          {debts.map((d) => (
            <li key={d.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-ink-3">
                    {DEBT_KIND_LABELS[d.kind]} ·{" "}
                    <span className={d.aprSource === "unknown" ? "text-warn" : ""}>
                      {d.apr !== null ? `${pct(d.apr)} APR` : "APR unknown"} ({SOURCE[d.aprSource]})
                    </span>
                    {d.escrowMonthlyCents > 0 ? ` · escrow ${usdCents(d.escrowMonthlyCents)}/mo` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num font-medium">{usdCents(d.balanceCents)}</span>
                  {d.accountId ? null : (
                    <ButtonForm
                      action={deleteDebtAction}
                      label="Delete"
                      confirm={`Delete ${d.name}?`}
                      hidden={{ id: d.id }}
                    />
                  )}
                </div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">Edit</summary>
                <div className="mt-3">
                  <DebtForm
                    v={{
                      id: d.id,
                      name: d.name,
                      kind: d.kind,
                      balance: dollarsText(d.balanceCents),
                      apr: d.apr !== null ? String(Math.round(d.apr * 1e6) / 1e4) : "",
                      ...(() => {
                        const r = d.minPaymentRule as {
                          type: string;
                          amount?: number;
                          floor?: number;
                          pct?: number;
                        };
                        return r.type === "card"
                          ? {
                              minType: "card" as const,
                              cardFloor: String(r.floor ?? 35),
                              cardPct: String((r.pct ?? 0.01) * 100),
                            }
                          : { minType: "fixed" as const, minAmount: String(r.amount ?? "") };
                      })(),
                      promoApr: d.promoApr !== null ? String(d.promoApr * 100) : "",
                      ...(d.promoEndsMonth !== null ? { promoEnds: monthText(d.promoEndsMonth) } : {}),
                      escrow: d.escrowMonthlyCents ? dollarsText(d.escrowMonthlyCents) : "",
                    }}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Payoff planner">
        <DebtPlanner
          debts={engineDebts}
          startMonth={startMonth}
          scenarioId={plan.scenario.id}
          initial={{
            strategy: plan.scenario.debtPlan.strategy,
            extraMonthly: plan.scenario.debtPlan.extraMonthly,
            hybridThreshold: plan.scenario.debtPlan.hybridThreshold,
            customOrder: plan.scenario.debtPlan.customOrder,
          }}
        />
      </Card>

      <Card title="Add a debt">
        <DebtForm />
      </Card>
      <Disclaimer />
    </div>
  );
}
