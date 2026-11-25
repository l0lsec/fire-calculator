"use client";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";
import type { ChartPoint } from "@/server/dashboard";

export function ProjectionChart({ data }: { data: ChartPoint[] }) {
  return (
    <figure
      className="h-72 w-full sm:h-80"
      aria-label="Projected portfolio against FI targets, in today's dollars"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 11, fill: "var(--ink-3)" }}
            minTickGap={32}
            tickFormatter={(v: number) => `${Math.round(v)}`}
          />
          <YAxis
            tickFormatter={(v: number) => usd(v, { compact: true })}
            tick={{ fontSize: 11, fill: "var(--ink-3)" }}
            width={68}
          />
          <Tooltip
            labelFormatter={(_, p) => {
              const pt = p?.[0]?.payload as ChartPoint | undefined;
              return pt ? `${pt.label} (age ${pt.age})` : "";
            }}
            formatter={(v, name) => [usd(Number(v)), String(name)]}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="portfolio"
            name="Portfolio"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.18}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="coast"
            name="Coast FI"
            stroke="var(--chart-4)"
            dot={false}
            strokeDasharray="4 3"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="lean"
            name="Lean FI"
            stroke="var(--chart-5)"
            dot={false}
            strokeDasharray="2 3"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="fi"
            name="FI"
            stroke="var(--chart-2)"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="fat"
            name="Fat FI"
            stroke="var(--chart-3)"
            dot={false}
            strokeDasharray="6 3"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
