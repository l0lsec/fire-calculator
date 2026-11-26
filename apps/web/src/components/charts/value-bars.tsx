"use client";
// One measure compared across a few named things (scenarios): horizontal bars from
// a shared zero, at most 24 px thick, the value printed at each bar's tip. A single
// series, so no legend: the card heading names the measure.
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, ChartTable } from "./kit";

export interface ValueBar {
  name: string;
  value: number;
  /** The text at the bar's tip and in the tooltip. */
  text: string;
}

export function ValueBars({
  bars,
  label,
  valueLabel,
  color = "var(--chart-1)",
  testId,
}: {
  bars: ValueBar[];
  label: string;
  /** Heading of the value column in the table ("Reaches FI"). */
  valueLabel: string;
  color?: string;
  testId?: string;
}) {
  if (bars.length === 0) return null;
  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <div className="w-full" style={{ height: 24 + bars.length * 40 }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 136, bottom: 4, left: 8 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="name"
              tick={AXIS_TICK}
              width={112}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p) => {
                const row = p.payload?.[0]?.payload as ValueBar | undefined;
                if (!p.active || !row) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="num font-semibold text-ink">{row.text}</p>
                    <p className="text-ink-2">{row.name}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill={color} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="text" position="right" className="num" fill="var(--ink)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption={label}
        columns={[
          { key: "name", label: "Scenario", align: "left" },
          { key: "text", label: valueLabel },
        ]}
        rows={bars.map((b) => ({ name: b.name, text: b.text }))}
      />
    </figure>
  );
}
