"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usd } from "@/lib/format";

export function NetWorthChart({ data }: { data: { date: string; netWorth: number }[] }) {
  return (
    <figure className="h-64 w-full" aria-label="Net worth over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={40} />
          <YAxis
            tickFormatter={(v: number) => usd(v, { compact: true })}
            tick={{ fontSize: 11, fill: "var(--ink-3)" }}
            width={68}
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
          <Area
            type="monotone"
            dataKey="netWorth"
            name="Net worth"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
