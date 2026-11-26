import { Card } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { dateText, usd } from "@/lib/format";
import { netWorthHistory } from "@/server/export";
import { ExportLink } from "./export-link";
import { NetWorthChart } from "./net-worth-chart";

export const metadata = { title: "History | FIRE Planner" };

export default async function HistoryPage() {
  const ctx = await requireContext();
  const points = await netWorthHistory(ctx, "1900-01-01", "2999-12-31");
  const data = points.map((p) => ({ date: p.date, netWorth: p.netWorthCents / 100 }));
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">History</h1>
      <Card title="Net worth">
        {data.length < 2 ? (
          <p className="text-sm text-ink-3">
            Daily balances from connected accounts build this chart over time.
          </p>
        ) : (
          <>
            <NetWorthChart data={data} />
            <p className="num mt-2 text-sm text-ink-3">
              {first ? dateText(first.date) : ""}: {usd(first?.netWorth ?? 0)} to{" "}
              {last ? dateText(last.date) : ""}: {usd(last?.netWorth ?? 0)}
            </p>
          </>
        )}
      </Card>
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
