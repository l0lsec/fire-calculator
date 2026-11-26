"use client";
// One series of monthly amounts as bars, with the monthly average as a dashed
// reference line. One series, so no legend: the card title names it.
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" to "Mar 26". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? ym} ${String(y).slice(2)}`;
}

export function MonthlyBars({
  data,
  label,
  testId,
}: {
  data: { month: string; cents: number }[];
  label: string;
  testId?: string;
}) {
  const rows = data.map((d) => ({ month: monthLabel(d.month), value: d.cents / 100 }));
  const withData = rows.filter((r) => r.value !== 0);
  const average = withData.length ? withData.reduce((s, r) => s + r.value, 0) / withData.length : 0;
  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <div className="h-56 w-full" role="img" aria-label={`${label}, average ${usd(average)} a month`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "var(--ink-3)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => usd(v, { compact: true })}
              tick={{ fontSize: 11, fill: "var(--ink-3)" }}
              width={64}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              formatter={(v) => [usd(Number(v)), "Spent"]}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={average} stroke="var(--ink-3)" strokeDasharray="4 4" />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-ink-3">
        Dashed line: your average month with spending, <span className="num">{usd(average)}</span>.
      </figcaption>
    </figure>
  );
}
