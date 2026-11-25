"use client";
import type { Debt } from "@fire/engine/core";
import type { DebtResult } from "@fire/engine/debt";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthName, usd } from "@/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function PayoffChart({
  result,
  debts,
  startMonth,
}: {
  result: DebtResult;
  debts: Debt[];
  startMonth: number;
}) {
  const step = Math.max(1, Math.ceil(result.schedule.length / 120));
  const rows: Record<string, number | string>[] = [
    { k: 0, label: monthName(startMonth), ...result.initialBalances },
  ];
  for (let i = step - 1; i < result.schedule.length; i += step) {
    const r = result.schedule[i];
    if (r) rows.push({ k: r.k, label: monthName(startMonth + r.k), ...r.balances });
  }
  return (
    <figure className="h-64 w-full" aria-label="Debt balances over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={40} />
          <YAxis
            tickFormatter={(v: number) => usd(v, { compact: true })}
            tick={{ fontSize: 11, fill: "var(--ink-3)" }}
            width={64}
          />
          <Tooltip
            formatter={(v) => usd(Number(v))}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          {debts.map((d, i) => (
            <Area
              key={d.id}
              type="monotone"
              dataKey={d.id}
              name={d.name}
              stackId="1"
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
