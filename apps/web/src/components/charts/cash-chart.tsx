"use client";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";

export interface CashPoint {
  /** "Dec 3" */
  label: string;
  /** Dollars after the day's scheduled bills and pay. */
  scheduled: number;
  /** Dollars if day-to-day spending also carries on at the usual pace. */
  pace: number;
}

/** The next 30 days of the spending accounts, with the cushion and zero marked. */
export function CashChart({ data, cushion }: { data: CashPoint[]; cushion: number }) {
  return (
    <figure
      className="h-64 w-full sm:h-72"
      aria-label="Projected balance of your spending accounts over the next 30 days"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={24} />
          <YAxis
            tickFormatter={(v: number) => usd(v, { compact: true })}
            tick={{ fontSize: 11, fill: "var(--ink-3)" }}
            width={68}
          />
          <Tooltip
            formatter={(v, name) => [usd(Number(v)), String(name)]}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="var(--bad)" strokeWidth={1.5} />
          {cushion > 0 ? (
            <ReferenceLine
              y={cushion}
              stroke="var(--warn)"
              strokeDasharray="4 3"
              label={{ value: "Cushion", fill: "var(--ink-3)", fontSize: 11, position: "insideTopLeft" }}
            />
          ) : null}
          <Area
            type="stepAfter"
            dataKey="scheduled"
            name="Bills and pay only"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="pace"
            name="At your usual spending"
            stroke="var(--chart-4)"
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
