// What each dashboard number is made of (the drill-down behind every tile and
// FI-ladder row). Every figure comes from the same engine rows the tile uses, and
// each step's lines evaluate to its total (test/breakdowns.test.ts checks this).

import { activeAdjustments, escrowMonthly, flowsAt, guaranteedIncomeAt } from "@fire/engine/cashflow";
import { type EngineInput, realRate } from "@fire/engine/core";
import { debtTermParts, type PlanResult, targetsAt } from "@fire/engine/levels";
import { fiPortfolio, type MonthRow, netWorth, real } from "@fire/engine/projection";
import {
  type Breakdown,
  type BreakdownLine,
  type BreakdownStep,
  foldSlices,
  type NotCounted,
} from "@/lib/breakdown";
import { age, dateText, monthName, pct, usd } from "@/lib/format";
import { BUCKET_LABELS } from "../accounts/labels";
import { type HouseholdPlan, MEASURED_INCOME_ID } from "../snapshot";
import { categoryLabel } from "../spending";

export type TileId = "fi-number" | "fi-date" | "invested" | "net-worth" | "savings-rate" | "spending";

const LINKS = {
  accounts: { href: "/accounts", label: "Accounts" },
  debts: { href: "/debts", label: "Debts" },
  spending: { href: "/spending", label: "Spending" },
  planSpending: { href: "/plan#spending", label: "Spending on Plan" },
  planIncome: { href: "/plan#income", label: "Income on Plan" },
  planRetirement: { href: "/plan#retirement-spending", label: "Retirement spending on Plan" },
  assumptions: { href: "/plan#assumptions", label: "Assumptions on Plan" },
  scenarios: { href: "/scenarios", label: "Try a what-if" },
} as const;

const add = (label: string, value: number, detail?: string, testId?: string): BreakdownLine => ({
  op: "+",
  label,
  value,
  ...(detail ? { detail } : {}),
  ...(testId ? { testId } : {}),
});
const sub = (label: string, value: number, detail?: string, testId?: string): BreakdownLine => ({
  ...add(label, value, detail, testId),
  op: "-",
});
/** A signed amount as a + or - line. */
const signed = (label: string, value: number, detail?: string): BreakdownLine =>
  value < 0 ? sub(label, -value, detail) : add(label, value, detail);

interface Parts {
  plan: HouseholdPlan;
  input: EngineInput;
  result: PlanResult;
  row0: MonthRow;
}

function parts(plan: HouseholdPlan): Parts | null {
  if (!plan.input || !plan.result) return null;
  const row0 = plan.result.accumulation.rows[0];
  return row0 ? { plan, input: plan.input, result: plan.result, row0 } : null;
}

const overridden = (plan: HouseholdPlan) =>
  plan.scenario.spendingOverrideCents !== null && plan.scenario.spendingOverrideCents !== undefined;

function spendingDetail(plan: HouseholdPlan): string {
  if (overridden(plan)) {
    return `set by the ${plan.scenario.name} scenario`;
  }
  return plan.data.spendingSource === "plaid" ? "measured from your connected accounts" : "your estimate";
}

// ---------- savings rate ----------

export interface FirstYear {
  months: number;
  income: { label: string; value: number; detail: string }[];
  contributions: { label: string; value: number; detail: string }[];
  living: number;
  escrow: number;
  interest: number;
  gross: number;
  saved: number;
  rate: number | null;
  /** The same split month by month (k = 1..months); each month's parts add up to its income. */
  byMonth: { k: number; income: number; living: number; escrow: number; interest: number; saved: number }[];
}

/** The next 12 months on the keep-working path, split the way the savings rate counts them. */
export function firstYear(p: Parts): FirstYear {
  const { input, result } = p;
  const acc = result.accumulation;
  const months = Math.min(12, acc.rows.length - 1);
  const extra = new Set(p.plan.scenario.extraIncome.map((s) => s.id));
  const sumOver = (f: (k: number) => number) => {
    let v = 0;
    for (let k = 1; k <= months; k++) v += f(k);
    return v;
  };
  // Pay and contributions per source per month, so the totals and the monthly
  // split are the same numbers.
  const incomeAt = (k: number) =>
    input.income.reduce(
      (v, s) => v + flowsAt({ ...input, income: [s], contributions: [] }, k, false).income,
      0,
    ) +
    input.contributions.reduce(
      (v, c) => v + flowsAt({ ...input, income: [], contributions: [c] }, k, false).contributionTotal,
      0,
    );
  const income = input.income
    .map((s) => ({
      label: s.name,
      value: sumOver((k) => flowsAt({ ...input, income: [s], contributions: [] }, k, false).income),
      detail:
        s.id === MEASURED_INCOME_ID
          ? "measured from your connected accounts"
          : extra.has(s.id)
            ? `added by the ${p.plan.scenario.name} scenario`
            : "entered on Plan",
    }))
    .filter((l) => Math.abs(l.value) > 0.005);
  const contributions = input.contributions
    .map((c) => ({
      label: c.name,
      value: sumOver(
        (k) => flowsAt({ ...input, income: [], contributions: [c] }, k, false).contributionTotal,
      ),
      detail: `taken from pay before tax, into ${BUCKET_LABELS[c.bucket].toLowerCase()}`,
    }))
    .filter((l) => Math.abs(l.value) > 0.005);
  let living = 0;
  let escrow = 0;
  const byMonth: FirstYear["byMonth"] = [];
  for (let k = 1; k <= months; k++) {
    const f = flowsAt(input, k, false);
    const m = {
      income: incomeAt(k),
      living: f.livingExpenses - f.escrow,
      escrow: f.escrow,
      interest: acc.debt.schedule[k - 1]?.totalInterest ?? 0,
    };
    byMonth.push({ k, ...m, saved: m.income - m.living - m.escrow - m.interest });
    living += m.living;
    escrow += m.escrow;
  }
  const interest = sumOver((k) => acc.debt.schedule[k - 1]?.totalInterest ?? 0);
  const gross = [...income, ...contributions].reduce((s, l) => s + l.value, 0);
  const saved = gross - living - escrow - interest;
  return {
    months,
    income,
    contributions,
    living,
    escrow,
    interest,
    gross,
    saved,
    rate: gross > 0 ? saved / gross : null,
    byMonth,
  };
}

function savingsRateBreakdown(p: Parts, y: FirstYear): Breakdown {
  const steps: BreakdownStep[] = [
    {
      title: `Coming in, next ${y.months} months`,
      lines: [
        ...y.income.map((l, i) => add(l.label, l.value, l.detail, i === 0 ? "sr-income" : undefined)),
        ...y.contributions.map((l) => add(l.label, l.value, l.detail)),
      ],
      total: { label: "Income", value: y.gross, testId: "sr-gross" },
    },
    {
      title: "Going out",
      lines: [
        add("Income", y.gross),
        sub("Living spending", y.living, spendingDetail(p.plan), "sr-spending"),
        ...(y.escrow > 0.005 ? [sub("Mortgage escrow", y.escrow, "property tax and insurance")] : []),
        ...(y.interest > 0.005
          ? [sub("Interest on debts", y.interest, "principal you pay down counts as saving")]
          : []),
      ],
      total: { label: "Saved", value: y.saved, testId: "sr-saved" },
    },
  ];
  if (y.rate !== null) {
    steps.push({
      lines: [add("Saved", y.saved), { op: "÷", label: "Income", value: y.gross }],
      total: { label: "Savings rate", value: y.rate, format: "pct", testId: "sr-rate" },
    });
  }
  return {
    id: "savings-rate",
    title: "Savings rate",
    chart: {
      title: "Where your income goes, next 12 months",
      slices: foldSlices([
        { label: "Living spending", value: y.living },
        { label: "Mortgage escrow", value: y.escrow },
        { label: "Debt interest", value: y.interest },
        { label: "Saved", value: y.saved },
      ]),
    },
    intro:
      "The share of your income you keep over the next 12 months: income minus spending and debt interest. Pay and spending grow with your raise and inflation assumptions.",
    steps,
    facts:
      y.rate === null ? [{ label: "Savings rate", value: "n/a: the plan has no income in this period" }] : [],
    links: [
      LINKS.planIncome,
      p.plan.data.spendingSource === "plaid" ? LINKS.spending : LINKS.planSpending,
      ...(y.interest > 0.005 ? [LINKS.debts] : []),
    ],
  };
}

// ---------- invested toward FI and net worth ----------

const counted = (a: EngineInput["accounts"][number]) => a.includeInFI && a.bucket !== "excluded";

function investedBreakdown(p: Parts): Breakdown {
  const { input, row0 } = p;
  const cash = row0.buckets.cash;
  // What fiPortfolio leaves out of cash: all of it up to the reserve.
  const held = cash - Math.max(0, cash - row0.reserve);
  const months = input.assumptions.emergencyMonths;
  const notCounted: NotCounted[] = input.accounts
    .filter((a) => !counted(a))
    .map((a) => ({
      label: a.name,
      value: a.balance,
      reason:
        a.bucket === "excluded"
          ? "Marked as not part of FI (a home, car or 529, for example)."
          : "Switched off: not counted toward FI.",
    }));
  return {
    id: "invested",
    title: "Invested toward FI",
    chart: {
      title: "Invested toward FI by account type",
      slices: foldSlices(
        input.accounts.filter(counted).map((a) => ({
          label: BUCKET_LABELS[a.bucket],
          value: a.bucket === "cash" ? a.balance * (cash > 0 ? (cash - held) / cash : 0) : a.balance,
        })),
      ),
    },
    intro:
      "The money that can fund your retirement: every account counted toward FI, less the emergency reserve you keep in cash.",
    steps: [
      {
        lines: [
          ...input.accounts
            .filter(counted)
            .map((a) => add(a.name, a.balance, BUCKET_LABELS[a.bucket], `inv-${a.id}`)),
          ...(Math.abs(held) > 0.005
            ? [
                sub(
                  "Emergency reserve kept in cash",
                  held,
                  cash < row0.reserve
                    ? `${months} months of essentials (${usd(row0.reserve)}); your cash is below that, so none of it counts yet`
                    : `${months} months of essential spending, set on Plan`,
                  "inv-reserve",
                ),
              ]
            : []),
        ],
        total: { label: "Invested toward FI", value: real(row0, fiPortfolio(row0)), testId: "inv-total" },
      },
    ],
    notCounted,
    links: [LINKS.accounts, ...(months > 0 ? [LINKS.assumptions] : [])],
  };
}

function leftOutDebts(plan: HouseholdPlan): NotCounted[] {
  return plan.data.debts
    .filter((d) => d.apr === null && d.balanceCents > 0)
    .map((d) => ({
      label: d.name,
      value: d.balanceCents / 100,
      reason: "No interest rate yet, so it is left out of the plan. Add the rate on Debts.",
    }));
}

function netWorthBreakdown(p: Parts): Breakdown {
  const { input, row0 } = p;
  const own = input.accounts.reduce((s, a) => s + a.balance, 0);
  return {
    id: "net-worth",
    title: "Net worth",
    chart: {
      title: "What you own, by account type",
      slices: foldSlices(
        input.accounts.map((a) => ({
          label: counted(a) ? BUCKET_LABELS[a.bucket] : "Not counted toward FI",
          value: a.balance,
        })),
      ),
    },
    intro: "Everything you own, including accounts not counted toward FI, minus everything you owe.",
    steps: [
      {
        title: "What you own",
        lines: input.accounts.map((a) =>
          add(a.name, a.balance, counted(a) ? BUCKET_LABELS[a.bucket] : "not counted toward FI"),
        ),
        total: { label: "Assets", value: own },
      },
      {
        title: "What you owe",
        lines: [add("Assets", own), ...input.debts.map((d) => sub(d.name, d.balance))],
        total: { label: "Net worth", value: netWorth(row0), testId: "nw-total" },
      },
    ],
    notCounted: leftOutDebts(p.plan),
    links: [LINKS.accounts, LINKS.debts],
  };
}

// ---------- spending ----------

function spendingBreakdown(p: Parts): Breakdown {
  const { input, plan } = p;
  const d = plan.data.derivedSpending;
  const facts: { label: string; value: string }[] = [];
  if (plan.data.spendingSource === "plaid" && d) {
    facts.push({
      label: "Measured over",
      value: `${d.monthsOfData} months, ${dateText(d.windowStart)} to ${dateText(d.windowEnd)}`,
    });
    if (d.businessCents !== 0) facts.push({ label: "Of which business", value: usd(d.businessCents / 100) });
  }
  facts.push({ label: "Of which essential", value: `${usd(input.spending.currentEssentialAnnual)} a year` });
  return {
    id: "spending",
    title: "Spending",
    chart: {
      title: "Spending by category",
      slices: foldSlices(
        plan.data.spendingSource === "plaid" && d && !overridden(plan)
          ? [
              ...d.byCategory.map((c) => ({ label: categoryLabel(c.category), value: c.totalCents / 100 })),
              { label: "Mortgage escrow", value: escrowMonthly(input) * 12 },
            ]
          : [
              { label: "Living spending", value: input.spending.currentAnnual },
              { label: "Mortgage escrow", value: escrowMonthly(input) * 12 },
            ],
      ),
    },
    intro:
      "What you spend on living in a year, in today's dollars. Debt payments and money you invest are not spending; mortgage escrow is.",
    steps: [
      {
        lines: [
          add("Living spending", input.spending.currentAnnual, spendingDetail(plan), "sp-living"),
          ...input.debts
            .filter((x) => x.escrowMonthly > 0)
            .map((x) => add(`Escrow on ${x.name}`, x.escrowMonthly * 12, "property tax and insurance")),
        ],
        total: {
          label: "Spending per year",
          value: input.spending.currentAnnual + escrowMonthly(input) * 12,
          testId: "sp-total",
        },
      },
    ],
    facts,
    links: [plan.data.spendingSource === "plaid" ? LINKS.spending : LINKS.planSpending],
  };
}

// ---------- FI number and the ladder targets ----------

type Need = "total" | "essential" | "fat";

/** The yearly spending a target is built on, at the start, as + / - lines. */
function spendingLines(p: Parts, need: Need): { lines: BreakdownLine[]; total: number } {
  const { input, row0 } = p;
  const a = input.assumptions;
  const escrow = escrowMonthly(input) * 12;
  const adj = activeAdjustments(input, row0.age);
  const total = Math.max(0, input.spending.currentAnnual + escrow + adj.reduce((s, x) => s + x.annual, 0));
  if (need === "fat") {
    if (a.fatAnnual !== undefined && a.fatAnnual !== null) {
      return { lines: [add("Fat FI spending you set", a.fatAnnual, "on Plan")], total: a.fatAnnual };
    }
    return {
      lines: [
        add("Retirement spending", total),
        { op: "×", label: "Fat FI multiplier", value: a.fatMultiplier, format: "number" },
      ],
      total: total * a.fatMultiplier,
    };
  }
  const essential = need === "essential";
  const lines: BreakdownLine[] = [
    add(
      essential ? "Essential spending" : "Living spending",
      essential ? input.spending.currentEssentialAnnual : input.spending.currentAnnual,
      spendingDetail(p.plan),
    ),
    ...(escrow > 0 ? [add("Mortgage escrow", escrow, "continues after the loan is paid off")] : []),
    ...adj
      .filter((x) => !essential || x.essential)
      .map((x) => signed(x.label, x.annual, "retirement adjustment")),
  ];
  // The same limits retirementSpendingAt applies: never below zero, essentials never above the total.
  const raw = lines.reduce((s, l) => s + (l.op === "-" ? -l.value : l.value), 0);
  const value = essential ? Math.max(0, Math.min(raw, total)) : total;
  if (Math.abs(value - raw) > 1e-9) {
    lines.push(signed(essential ? "Capped at total spending" : "Not below zero", value - raw));
  }
  return { lines, total: value };
}

/** spendNeed() as lines: spending, less counted guaranteed income, over the withdrawal rate, grossed up for tax. */
function needLines(p: Parts, spend: number): BreakdownLine[] {
  const { input, row0 } = p;
  const a = input.assumptions;
  const g = a.countGuaranteedIncome ? guaranteedIncomeAt(input, row0.age) : 0;
  const lines: BreakdownLine[] = [];
  if (g > 0) {
    lines.push(
      sub(
        "Social Security and pensions",
        Math.min(g, spend),
        g > spend ? "counted only up to your spending" : "counted now",
      ),
    );
  }
  lines.push({
    op: "÷",
    label: "Withdrawal rate",
    value: a.swr,
    format: "pct",
    detail: "the share you take out each year",
  });
  if (a.withdrawalTaxRate > 0) {
    lines.push({
      op: "÷",
      label: `Kept after ${pct(a.withdrawalTaxRate, 0)} tax on withdrawals`,
      value: 1 - a.withdrawalTaxRate,
      format: "pct",
    });
  }
  return lines;
}

function debtLines(p: Parts): BreakdownLine[] {
  const { input, result, row0 } = p;
  const names = new Map(input.debts.map((d) => [d.id, d.name]));
  return debtTermParts(input, result.accumulation, row0).map((d) =>
    add(
      names.get(d.id) ?? "Debt",
      d.amount,
      d.presentValue
        ? "kept mortgage: what its remaining payments cost today"
        : "paid off from the portfolio at FI",
    ),
  );
}

function targetStep(p: Parts, need: Need, label: string, value: number, testId?: string): BreakdownStep[] {
  const spend = spendingLines(p, need);
  return [
    {
      title: "Yearly spending it must cover",
      lines: spend.lines,
      total: {
        label: need === "essential" ? "Essential spending" : "Retirement spending",
        value: spend.total,
      },
    },
    {
      title: "Turned into a portfolio",
      lines: [
        add(need === "essential" ? "Essential spending" : "Retirement spending", spend.total),
        ...needLines(p, spend.total),
        ...debtLines(p),
      ],
      total: { label, value, ...(testId ? { testId } : {}) },
    },
  ];
}

function toGoStep(target: number, current: number, currentLabel: string): BreakdownStep[] {
  if (current >= target - 0.005) return [];
  return [
    {
      lines: [add("Target", target), sub(currentLabel, current)],
      total: { label: "Still to go", value: target - current },
    },
  ];
}

function fiNumberBreakdown(p: Parts): Breakdown {
  const t0 = p.result.levels;
  return {
    id: "fi-number",
    title: "Your FI number",
    chart: {
      title: "What your FI number pays for",
      slices: foldSlices([
        { label: "Retirement spending", value: t0.fi - t0.debt },
        ...debtLines(p).map((l) => ({ label: l.label, value: l.value })),
      ]),
    },
    intro:
      "The portfolio that pays for your retirement spending at your withdrawal rate, plus any debt still owed, in today's dollars.",
    steps: targetStep(p, "total", "FI number", t0.fi, "fin-total"),
    links: [LINKS.planRetirement, LINKS.assumptions, ...(p.input.debts.length ? [LINKS.debts] : [])],
  };
}

function fiDateBreakdown(p: Parts, y: FirstYear): Breakdown {
  const { input, result, row0 } = p;
  const acc = result.accumulation;
  const portfolio = real(row0, fiPortfolio(row0));
  const a = input.assumptions;
  const facts = [
    { label: "Saved in the next 12 months", value: usd(y.saved) },
    {
      label: "Expected return",
      value: `${pct(a.nominalReturn)} a year, ${pct(realRate(a.nominalReturn, a.inflation))} after ${pct(a.inflation)} inflation`,
    },
  ];
  const at = result.fiK !== null ? acc.rows[result.fiK] : acc.rows[acc.rows.length - 1];
  if (at) {
    const t = targetsAt(input, acc, at);
    facts.push({
      label:
        result.fiK !== null
          ? `In ${monthName(input.startMonth + at.k)}`
          : `At the end of the plan (age ${age(at.age)})`,
      value: `${usd(real(at, fiPortfolio(at)))} invested against an FI number of ${usd(t.fi)}`,
    });
  }
  return {
    id: "fi-date",
    title: "FI date",
    intro:
      "The first month your invested money reaches your FI number if you keep working and saving as planned. The FI number moves too, as debts are paid off.",
    steps: toGoStep(result.levels.fi, portfolio, "Invested toward FI now"),
    facts,
    links: [LINKS.planIncome, LINKS.assumptions, LINKS.scenarios],
  };
}

// ---------- the FI ladder ----------

function ladderBreakdown(p: Parts, id: string, label: string, target: number, current: number): Breakdown {
  const { input, row0, result } = p;
  const base = { id: `ladder-${id}`, title: label };
  const portfolio = real(row0, fiPortfolio(row0));
  const debtsIn = (keep: (d: EngineInput["debts"][number]) => boolean, title: string): Breakdown => {
    const rows = input.debts.filter(keep);
    return {
      ...base,
      intro: `${title} The date assumes you follow the payoff plan on Debts.`,
      steps: rows.length
        ? [
            {
              lines: rows.map((d) => add(d.name, d.balance, `${pct(d.apr)} APR`)),
              total: { label: "Owed now", value: current },
            },
          ]
        : [],
      notCounted: leftOutDebts(p.plan),
      links: [LINKS.debts],
    };
  };
  const threshold = input.debtPlan.hybridThreshold;
  switch (id) {
    case "emergency": {
      const monthly = flowsAt(input, 0, false).essentialExpenses;
      return {
        ...base,
        intro: "Cash set aside for emergencies. It is filled first, before you invest.",
        steps: [
          {
            lines: [
              add("Essential spending per month", monthly),
              {
                op: "×",
                label: "Months to keep",
                value: input.assumptions.emergencyMonths,
                format: "number",
              },
            ],
            total: { label: "Emergency fund", value: target },
          },
          ...toGoStep(target, current, "Cash you hold"),
        ],
        links: [LINKS.assumptions, LINKS.accounts],
      };
    }
    case "highInterestDebtFree":
      return debtsIn(
        (d) => d.apr > threshold,
        `Debts charging more than ${pct(threshold, 0)} a year, the ones worth paying off first.`,
      );
    case "consumerDebtFree":
      return debtsIn((d) => d.kind !== "mortgage", "Every debt except the mortgage.");
    case "debtFree":
      return debtsIn(() => true, "Every debt, including the mortgage.");
    case "fi": {
      const fi = fiNumberBreakdown(p);
      return { ...fi, ...base, steps: [...fi.steps, ...toGoStep(target, portfolio, "Invested toward FI")] };
    }
    case "lean":
      return {
        ...base,
        intro: "FI on essential spending only: the floor that covers needs, not wants.",
        steps: [
          ...targetStep(p, "essential", "Lean FI", target),
          ...toGoStep(target, portfolio, "Invested toward FI"),
        ],
        links: [LINKS.spending, LINKS.assumptions],
      };
    case "fat":
      return {
        ...base,
        intro: "FI with room to spend more than you do today.",
        steps: [
          ...targetStep(p, "fat", "Fat FI", target),
          ...toGoStep(target, portfolio, "Invested toward FI"),
        ],
        links: [LINKS.assumptions],
      };
    case "halfFI":
      return {
        ...base,
        intro: "Half of your FI number: a milestone on the way.",
        steps: [
          {
            lines: [
              add("FI number", result.levels.fi),
              { op: "×", label: "Half", value: 0.5, format: "pct" },
            ],
            total: { label: "Half FI", value: target },
          },
          ...toGoStep(target, portfolio, "Invested toward FI"),
        ],
        links: [LINKS.assumptions],
      };
    case "coast": {
      const a = input.assumptions;
      const years = a.retirementAge - row0.age;
      if (years <= 0) {
        return {
          ...base,
          intro: `You are past age ${a.retirementAge}, so Coast FI is the same as your FI number.`,
          steps: [...fiNumberBreakdown(p).steps, ...toGoStep(target, portfolio, "Invested toward FI")],
          links: [LINKS.assumptions],
        };
      }
      const growth = (1 + realRate(a.nominalReturn, a.inflation)) ** years;
      return {
        ...base,
        intro: `Enough invested that growth alone reaches your FI number by age ${a.retirementAge}, even if you stop saving.`,
        steps: [
          {
            lines: [
              add(`FI number at age ${a.retirementAge}`, target * growth),
              {
                op: "÷",
                label: `Growth over ${age(years)} years`,
                value: growth,
                format: "number",
                detail: `at ${pct(realRate(a.nominalReturn, a.inflation))} a year after inflation`,
              },
            ],
            total: { label: "Coast FI", value: target },
          },
          ...toGoStep(target, portfolio, "Invested toward FI"),
        ],
        links: [LINKS.assumptions],
      };
    }
    default:
      return {
        ...base,
        intro:
          id === "barista"
            ? "FI with part-time income covering part of your spending, as set on Plan."
            : "A milestone on the way to FI.",
        steps: toGoStep(target, current, "Invested toward FI"),
        links: [LINKS.assumptions],
      };
  }
}

export interface DashboardBreakdowns {
  tiles: Record<TileId, Breakdown>;
  ladder: Record<string, Breakdown>;
  firstYear: FirstYear;
}

export function dashboardBreakdowns(
  plan: HouseholdPlan,
  ladder: { id: string; label: string; target: number; current: number }[],
): DashboardBreakdowns | null {
  const p = parts(plan);
  if (!p) return null;
  const y = firstYear(p);
  return {
    firstYear: y,
    tiles: {
      "fi-number": fiNumberBreakdown(p),
      "fi-date": fiDateBreakdown(p, y),
      invested: investedBreakdown(p),
      "net-worth": netWorthBreakdown(p),
      "savings-rate": savingsRateBreakdown(p, y),
      spending: spendingBreakdown(p),
    },
    ladder: Object.fromEntries(
      ladder.map((l) => [l.id, ladderBreakdown(p, l.id, l.label, l.target, l.current)]),
    ),
  };
}

// ---------- other pages ----------

/** Accounts page: what "Counting toward FI" adds up, and what is left out. */
export function accountsBreakdown(
  accounts: {
    id: string;
    name: string;
    bucket: keyof typeof BUCKET_LABELS;
    currentCents: number;
    includeInFi: boolean;
  }[],
): Breakdown {
  const isCounted = (a: (typeof accounts)[number]) => a.includeInFi && a.bucket !== "excluded";
  const rows = accounts.filter(isCounted);
  return {
    id: "counting",
    title: "Counting toward FI",
    intro:
      "The balances of every account counted toward FI. On the dashboard, Invested toward FI also keeps your emergency reserve out of your cash.",
    chart: {
      title: "Counting toward FI by account type",
      slices: foldSlices(rows.map((a) => ({ label: BUCKET_LABELS[a.bucket], value: a.currentCents / 100 }))),
    },
    steps: [
      {
        lines: rows.map((a) => add(a.name, a.currentCents / 100, BUCKET_LABELS[a.bucket], `acct-${a.id}`)),
        total: {
          label: "Counting toward FI",
          value: rows.reduce((s, a) => s + a.currentCents, 0) / 100,
          testId: "acct-total",
        },
      },
    ],
    notCounted: accounts
      .filter((a) => !isCounted(a))
      .map((a) => ({
        label: a.name,
        value: a.currentCents / 100,
        reason:
          a.bucket === "excluded"
            ? "Marked as not part of FI. Change it with Edit on its row."
            : "Switched off: not counted toward FI. Change it with Edit on its row.",
      })),
    links: [{ href: "/dashboard#invested", label: "Dashboard" }],
  };
}

/** Debts page: the total owed, and what the plan adds to your FI number for debt. */
export function debtsBreakdowns(plan: HouseholdPlan): { owed: Breakdown; fi: Breakdown | null } {
  const debts = plan.data.debts.filter((d) => d.balanceCents > 0);
  const total = debts.reduce((s, d) => s + d.balanceCents, 0) / 100;
  const left = debts.filter((d) => d.apr === null).reduce((s, d) => s + d.balanceCents, 0) / 100;
  const owed: Breakdown = {
    id: "owed",
    title: "Total owed",
    intro: "Every balance you owe today, from your bank connections and the debts you entered.",
    chart: {
      title: "Total owed by debt",
      slices: foldSlices(debts.map((d) => ({ label: d.name, value: d.balanceCents / 100 }))),
    },
    steps: [
      {
        lines: debts.map((d) =>
          add(d.name, d.balanceCents / 100, d.apr === null ? "rate needed" : `${pct(d.apr)} APR`),
        ),
        total: { label: "Total owed", value: total, testId: "debts-total" },
      },
      ...(left > 0
        ? [
            {
              lines: [add("Total owed", total), sub("Left out until its rate is added", left)],
              total: { label: "In your plan", value: total - left },
            },
          ]
        : []),
    ],
    links: [{ href: "/dashboard#net-worth", label: "Dashboard" }],
  };
  const p = parts(plan);
  if (!p) return { owed, fi: null };
  const policy =
    p.input.policy === "keepMortgage"
      ? "Your plan pays off everything but the mortgage at FI and keeps paying the mortgage, so it counts what those payments cost today."
      : "Your plan pays off every debt from the portfolio at FI, so each balance is added to your FI number.";
  return {
    owed,
    fi: {
      id: "fi-debt",
      title: "Added to your FI number",
      intro: `${policy} The debt policy is set on Scenarios.`,
      steps: [
        {
          lines: debtLines(p),
          total: { label: "Added to your FI number", value: p.result.levels.debt, testId: "debts-fi-total" },
        },
      ],
      links: [
        { href: "/dashboard#fi-number", label: "Dashboard" },
        { href: "/scenarios", label: "Scenarios" },
      ],
    },
  };
}
