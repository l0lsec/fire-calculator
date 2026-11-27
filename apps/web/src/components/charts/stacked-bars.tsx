"use client";
import { useState } from "react";
// Parts of a whole, period by period: one bar per month (or year) split into up to
// four series. Bars are at most 24 px wide, segments are separated by a surface
// gap, and the top segment carries the rounded end. A negative part (a month that
// spends more than it earns) hangs below the zero line. The legend names every
// series; the tooltip lists all of them with the total; the table has every value.
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
import type { Breakdown } from "@/lib/breakdown";
import { usd } from "@/lib/format";
import { PeriodDrill, pickedIndex } from "../period-drill";
import { AXIS_TICK, ChartLegend, ChartTable, compactUsd, type SeriesDef, SeriesTooltip } from "./kit";

export function StackedBars({
  rows,
  series,
  label,
  totalLabel,
  average,
  drill,
  testId,
}: {
  rows: ({ label: string } & Record<string, number | string>)[];
  series: SeriesDef[];
  /** What the chart shows, for screen readers and the table caption. */
  label: string;
  /** Name for the sum of the series in the tooltip and table ("Total spending"). */
  totalLabel: string;
  /** A dashed reference line with its description ("average month"). */
  average?: { value: number; label: string };
  /** What each bar is made of, in the same order as `rows`; tapping a bar opens it. */
  drill?: (Breakdown | null)[];
  testId?: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const num = (r: Record<string, number | string>, k: string) =>
    typeof r[k] === "number" ? (r[k] as number) : 0;
  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <ChartLegend series={series} shape="rect" />
      <div className="h-60 w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            stackOffset="sign"
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
            onClick={drill ? (state) => setPicked(pickedIndex(state)) : undefined}
            style={drill ? { cursor: "pointer" } : undefined}
          >
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickFormatter={compactUsd} tick={AXIS_TICK} width={64} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p) => (
                <SeriesTooltip
                  active={p.active}
                  label={p.label}
                  payload={p.payload}
                  series={series}
                  total={totalLabel}
                />
              )}
            />
            <ReferenceLine y={0} stroke="var(--line)" />
            {average ? <ReferenceLine y={average.value} stroke="var(--ink-3)" strokeDasharray="4 4" /> : null}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="a"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {average ? (
        <figcaption className="text-xs text-ink-3">
          Dashed line: {average.label}, <span className="num">{usd(average.value)}</span>.
        </figcaption>
      ) : null}
      {drill ? (
        <PeriodDrill
          periods={drill}
          picked={picked}
          onPick={setPicked}
          testId={testId ? `${testId}-drill` : undefined}
        />
      ) : null}
      <ChartTable
        caption={label}
        columns={[
          { key: "label", label: "Period", align: "left" },
          ...series.map((s) => ({ key: s.key, label: s.label })),
          { key: "total", label: totalLabel },
        ]}
        rows={rows.map((r) => ({
          label: r.label,
          ...Object.fromEntries(series.map((s) => [s.key, usd(num(r, s.key))])),
          total: usd(series.reduce((v, s) => v + num(r, s.key), 0)),
        }))}
      />
    </figure>
  );
}
