// What every cell of the Scenarios comparison is made of (docs/UX_PRINCIPLES.md,
// law 19). Milestone dates, the FI number and the FI date reuse the dashboard's
// breakdowns for that scenario's plan; interest and success rates are added here.
import type { Breakdown } from "@/lib/breakdown";
import { pct } from "@/lib/format";
import { dashboardBreakdowns } from "../dashboard/breakdowns";
import type { HouseholdPlan } from "../snapshot";
import { COMPARE_LEVELS, type CompareLevel, type ScenarioSummary } from "./index";

export type ScenarioCell = CompareLevel | "fi-number" | "interest" | "historical" | "simulated";

/** "1929-09" to "Sep 1929" */
function startLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const scoped = (sid: string, b: Breakdown, title: string): Breakdown => ({
  ...b,
  id: `${sid}-${b.id}`,
  title,
});

export function scenarioBreakdowns(
  plan: HouseholdPlan,
  s: ScenarioSummary,
): Partial<Record<ScenarioCell, Breakdown>> {
  const r = plan.result;
  if (!s.ready || !r) return {};
  const bd = dashboardBreakdowns(
    plan,
    r.ladder.map((l) => ({ id: l.id, label: l.label, target: l.target, current: l.current })),
  );
  if (!bd) return {};
  const out: Partial<Record<ScenarioCell, Breakdown>> = {};
  for (const level of COMPARE_LEVELS) {
    const b = level === "fi" ? bd.tiles["fi-date"] : bd.ladder[level];
    if (b) out[level] = scoped(s.id, b, `${s.name}: ${b.title}`);
  }
  out["fi-number"] = scoped(s.id, bd.tiles["fi-number"], `${s.name}: FI number`);

  const interest = s.totalInterest ?? 0;
  out.interest = {
    id: `${s.id}-interest`,
    title: `${s.name}: debt interest`,
    intro:
      "The interest each debt costs from today until it is paid off, on this scenario's payment plan, in the dollars of each month it is paid.",
    steps: [
      {
        lines: s.interestByDebt.length
          ? s.interestByDebt.map((d) => ({ op: "+" as const, label: d.name, value: d.interest }))
          : [{ op: "+", label: "No interest-bearing debt", value: 0 }],
        total: { label: "Debt interest", value: interest, testId: "interest-total" },
      },
    ],
    links: [
      { href: "/debts", label: "Debts" },
      { href: `/plan?scenario=${s.id}`, label: "This scenario's plan" },
    ],
  };

  if (s.historicalSuccess !== null && s.historicalStarts > 0) {
    const failed = s.historicalFailures.length;
    out.historical = {
      id: `${s.id}-historical`,
      title: `${s.name}: retirement success in history`,
      intro:
        "Your plan replayed from every start year since 1871 with real stock, bond and inflation history (60% stocks), retiring at this scenario's FI date. A start year succeeds when the money lasts.",
      steps: [
        {
          lines: [
            { op: "+", label: "Start years tried", value: s.historicalStarts, format: "number" },
            { op: "-", label: "Start years the money ran out", value: failed, format: "number" },
          ],
          total: {
            label: "Start years the money lasted",
            value: s.historicalStarts - failed,
            format: "number",
          },
        },
        {
          lines: [
            {
              op: "+",
              label: "Start years the money lasted",
              value: s.historicalStarts - failed,
              format: "number",
            },
            { op: "÷", label: "Start years tried", value: s.historicalStarts, format: "number" },
          ],
          total: { label: "Success", value: s.historicalSuccess, format: "pct" },
        },
      ],
      facts: failed
        ? [
            {
              label: "Ran out when starting in",
              value: s.historicalFailures.map(startLabel).join(", "),
            },
          ]
        : [{ label: "Ran out", value: "in no start year" }],
      links: [{ href: `/plan?scenario=${s.id}#assumptions`, label: "This scenario's assumptions" }],
    };
  }

  if (s.simulated && s.successRate !== null) {
    const { runs, successes } = s.simulated;
    out.simulated = {
      id: `${s.id}-simulated`,
      title: `${s.name}: simulated retirement success`,
      intro: `${runs} made-up market paths with returns that swing 15% a year around your ${pct(plan.scenario.assumptions.nominalReturn)} return assumption, retiring at this scenario's FI date. A path succeeds when the money lasts.`,
      steps: [
        {
          lines: [
            { op: "+", label: "Paths the money lasted", value: successes, format: "number" },
            { op: "÷", label: "Paths simulated", value: runs, format: "number" },
          ],
          total: { label: "Success", value: s.successRate, format: "pct" },
        },
      ],
      facts: [{ label: "Paths that ran out", value: `${runs - successes} of ${runs}` }],
      links: [{ href: `/plan?scenario=${s.id}#assumptions`, label: "This scenario's assumptions" }],
    };
  }
  return out;
}
