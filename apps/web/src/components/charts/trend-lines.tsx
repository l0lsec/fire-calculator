"use client";
import { useState } from "react";
// Two or three amounts over time on one dollar axis: 2 px lines, each with its own
// dash pattern as well as its color so the lines stay apart without color. Points
// are joined straight, never smoothed, so no curve suggests a value between them. A
// crosshair snaps to the nearest date and the tooltip lists every line there.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Breakdown } from "@/lib/breakdown";
import { usd } from "@/lib/format";
import { PeriodDrill, pickedIndex } from "../period-drill";
import { AXIS_TICK, ChartLegend, ChartTable, compactUsd, type SeriesDef, SeriesTooltip } from "./kit";

export function TrendLines({
  rows,
  series,
  label,
  xLabel,
  drill,
  drillNoun = "month",
  testId,
}: {
  rows: ({ label: string } & Record<string, number | string>)[];
  series: SeriesDef[];
  label: string;
  /** Heading of the first table column ("Date", "Month"). */
  xLabel: string;
  /** What each point is made of, in the same order as `rows`; tapping the chart opens it. */
  drill?: (Breakdown | null)[];
  /** What a row is ("month", "day"), for the picker. */
  drillNoun?: string;
  testId?: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <ChartLegend series={series} shape="line" />
      <div className="h-60 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
            onClick={drill ? (state) => setPicked(pickedIndex(state)) : undefined}
            style={drill ? { cursor: "pointer" } : undefined}
          >
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={40} />
            <YAxis tickFormatter={compactUsd} tick={AXIS_TICK} width={68} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
              content={(p) => (
                <SeriesTooltip active={p.active} label={p.label} payload={p.payload} series={series} />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {drill ? (
        <PeriodDrill
          periods={drill}
          picked={picked}
          onPick={setPicked}
          noun={drillNoun}
          testId={testId ? `${testId}-drill` : undefined}
        />
      ) : null}
      <ChartTable
        caption={label}
        columns={[
          { key: "label", label: xLabel, align: "left" },
          ...series.map((s) => ({ key: s.key, label: s.label })),
        ]}
        rows={rows.map((r) => ({
          label: r.label,
          ...Object.fromEntries(
            series.map((s) => [s.key, typeof r[s.key] === "number" ? usd(r[s.key] as number) : ""]),
          ),
        }))}
      />
    </figure>
  );
}
