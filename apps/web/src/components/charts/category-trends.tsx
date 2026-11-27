"use client";
import { useState } from "react";
// Category trends as small multiples: one small bar chart per category, all in one
// color, so each trend reads on its own without matching colors to a legend. Each
// chart has its own scale (the caption says so) because the question is "is this
// category rising?", not "which is biggest" (the By category list answers that).
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Breakdown } from "@/lib/breakdown";
import type { CategoryTrend } from "@/lib/chart-data";
import { usd } from "@/lib/format";
import { PeriodDrill, pickedIndex } from "../period-drill";
import { ChartTable } from "./kit";

export function CategoryTrends({
  trends,
  drill,
  testId,
}: {
  trends: CategoryTrend[];
  /** Per category, what each month's bar is made of (same order as its months). */
  drill?: Record<string, (Breakdown | null)[]>;
  testId?: string;
}) {
  const [picked, setPicked] = useState<{ category: string; index: number | null } | null>(null);
  if (trends.length === 0) return null;
  const months = trends[0]!.months.map((m) => m.month);
  const pickedTrend = picked ? trends.find((t) => t.category === picked.category) : undefined;
  /** The latest month with spending, so picking a category opens something. */
  const latest = (category: string) => {
    const periods = drill?.[category] ?? [];
    for (let i = periods.length - 1; i >= 0; i--) if (periods[i]) return i;
    return null;
  };
  return (
    <figure className="flex flex-col gap-3" data-testid={testId}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {trends.map((t) => {
          const peak = t.months.reduce((m, x) => Math.max(m, x.value), 0);
          return (
            <li key={t.category} className="flex flex-col gap-1" data-testid="category-trend">
              {drill?.[t.category] ? (
                <button
                  type="button"
                  aria-pressed={picked?.category === t.category}
                  onClick={() =>
                    setPicked(
                      picked?.category === t.category
                        ? null
                        : { category: t.category, index: latest(t.category) },
                    )
                  }
                  className={`-mx-2 flex min-h-10 items-baseline justify-between gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2 pointer-coarse:min-h-11 ${
                    picked?.category === t.category ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="min-w-0 truncate text-ink">{t.label}</span>
                  <span className="num text-ink-3">{usd(t.total)}</span>
                </button>
              ) : (
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink">{t.label}</span>
                  <span className="num text-ink-3">{usd(t.total)}</span>
                </div>
              )}
              <div
                className="h-20 w-full"
                role="img"
                aria-label={`${t.label} by month, highest ${usd(peak)}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={t.months}
                    margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                    onClick={
                      drill?.[t.category]
                        ? (state) => {
                            const index = pickedIndex(state);
                            if (index !== null) setPicked({ category: t.category, index });
                          }
                        : undefined
                    }
                    style={drill?.[t.category] ? { cursor: "pointer" } : undefined}
                  >
                    <XAxis dataKey="month" hide />
                    <YAxis hide domain={[0, "dataMax"]} />
                    <Tooltip
                      cursor={{ fill: "var(--surface-2)" }}
                      content={(p) => {
                        const v = p.payload?.[0]?.value;
                        if (!p.active || typeof v !== "number") return null;
                        return (
                          <div className="rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow-sm">
                            <span className="num font-semibold text-ink">{usd(v)}</span>{" "}
                            <span className="text-ink-2">{p.label}</span>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="value"
                      fill="var(--chart-2)"
                      maxBarSize={24}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-[11px] text-ink-3">
                <span>{months[0]}</span>
                <span>{months[months.length - 1]}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {picked && pickedTrend && drill?.[picked.category] ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">{pickedTrend.label}</p>
          <PeriodDrill
            periods={drill[picked.category]!}
            picked={picked.index}
            onPick={(index) => setPicked(index === null ? null : { category: picked.category, index })}
            testId={testId ? `${testId}-drill` : undefined}
          />
        </div>
      ) : null}
      <figcaption className="text-xs text-ink-3">
        Your largest categories, month by month. Each chart has its own scale; the figure beside the name is
        the total for the months shown.{drill ? " Tap a category or a bar to see its charges." : ""}
      </figcaption>
      <ChartTable
        caption="Largest categories by month"
        columns={[
          { key: "month", label: "Month", align: "left" },
          ...trends.map((t) => ({ key: t.category, label: t.label })),
        ]}
        rows={months.map((m, i) => ({
          month: m,
          ...Object.fromEntries(trends.map((t) => [t.category, usd(t.months[i]?.value ?? 0)])),
        }))}
      />
    </figure>
  );
}
