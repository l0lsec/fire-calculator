import { TrendLines } from "@/components/charts/trend-lines";
import { Card } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { moneyInOut } from "@/lib/chart-data";
import { dateText, usd } from "@/lib/format";
import { inOutMonthBreakdowns } from "@/server/charts/breakdowns";
import { balanceHistoryDetail } from "@/server/export";
import { todayISO } from "@/server/snapshot";
import { spendingView } from "@/server/spending";
import { ExportLink } from "./export-link";

export const metadata = { title: "History | FIRE Planner" };

export default async function HistoryPage() {
  const ctx = await requireContext();
  const [{ points, days }, { s, connected, charges }] = await Promise.all([
    balanceHistoryDetail(ctx, "1900-01-01", "2999-12-31"),
    spendingView(ctx, todayISO()),
  ]);
  const data = points.map((p) => ({
    label: dateText(p.date),
    netWorth: p.netWorthCents / 100,
    counted: p.countedCents / 100,
  }));
  const first = data[0];
  const last = data[data.length - 1];
  const inOut = connected
    ? moneyInOut(
        s.classified,
        s.monthly.map((m) => m.month),
      )
    : [];
  const months = inOut.filter((m) => m.income !== 0 || m.spending !== 0);
  const kept = months.reduce((v, m) => v + m.income - m.spending, 0);
  const inOutDrill = connected ? inOutMonthBreakdowns(s, charges) : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">History</h1>
      <Card title="Net worth and money counted toward FI">
        {data.length < 2 ? (
          <p className="text-sm text-ink-3">
            Daily balances from connected accounts build this chart over time.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-3">
              Net worth is everything you own less what you owe. Counted toward FI is the balance of the
              accounts that fund retirement (the dashboard also keeps your emergency reserve out of it).
            </p>
            <TrendLines
              rows={data}
              series={[
                { key: "netWorth", label: "Net worth", color: "var(--chart-1)" },
                { key: "counted", label: "Counted toward FI", color: "var(--chart-2)", dash: "6 4" },
              ]}
              label="Net worth and money counted toward FI over time"
              xLabel="Date"
              drill={days}
              drillNoun="day"
              testId="history-balances"
            />
            <p className="num mt-2 text-sm text-ink-3">
              Net worth {first?.label}: {usd(first?.netWorth ?? 0)} to {last?.label}:{" "}
              {usd(last?.netWorth ?? 0)}
            </p>
          </>
        )}
      </Card>
      {months.length > 1 ? (
        <Card title="Money in and out by month">
          <p className="mb-3 text-sm text-ink-3">
            Income landing in your connected accounts against living spending, the last 12 months. Transfers,
            card payments, loan payments and investing are left out of both.
          </p>
          <TrendLines
            rows={inOut.map((m) => ({ label: m.month, income: m.income, spending: m.spending }))}
            series={[
              { key: "income", label: "Income", color: "var(--chart-1)" },
              { key: "spending", label: "Living spending", color: "var(--chart-3)", dash: "6 4" },
            ]}
            label="Income and living spending by month"
            xLabel="Month"
            drill={inOutDrill}
            testId="history-in-out"
          />
          <p className="num mt-2 text-sm text-ink-3">
            {kept >= 0
              ? `${usd(kept)} more came in than went to living costs over these months.`
              : `${usd(-kept)} more went to living costs than came in over these months.`}
          </p>
        </Card>
      ) : null}
      <Card title="Export your data">
        <div className="flex flex-wrap gap-2 text-sm">
          <ExportLink href="/api/export?format=json" what="everything as JSON">
            Everything (JSON)
          </ExportLink>
          <ExportLink href="/api/export?format=csv&kind=transactions" what="your transactions as CSV">
            Transactions (CSV)
          </ExportLink>
          <ExportLink href="/api/export?format=csv&kind=accounts" what="your accounts as CSV">
            Accounts (CSV)
          </ExportLink>
          <ExportLink href="/api/export?format=csv&kind=debts" what="your debts as CSV">
            Debts (CSV)
          </ExportLink>
        </div>
        <p className="mt-3 text-xs text-ink-3">Exports never include bank credentials or access tokens.</p>
      </Card>
    </div>
  );
}
