// Monthly category budgets. Pure: classified transactions and budgets in,
// this month's progress out. Budgets are set per primary category (Food and
// drink, Entertainment, ...), the same level the spending page groups by.
import type { AnnualSpending, Classified } from "./index";

export interface Budget {
  category: string;
  monthlyCents: number;
}

export interface BudgetLine {
  /** Plaid primary category, e.g. FOOD_AND_DRINK. */
  category: string;
  budgetCents: number | null;
  /** Spent so far this month, refunds netted. */
  spentCents: number;
  /** Typical month over the last 12 full months (one-time items excluded). */
  averageCents: number;
  /** Where the month is heading: what is spent plus the typical rest of the month. */
  projectedCents: number;
  status: "none" | "under" | "near" | "over";
}

function daysInMonth(ym: string): number {
  return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
}

/** Typical monthly spending per primary category, from the annualized 12-month figures. */
export function monthlyAverages(spending: Pick<AnnualSpending, "byCategory">): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of spending.byCategory) out.set(c.primary, (out.get(c.primary) ?? 0) + c.totalCents / 12);
  for (const [k, v] of out) out.set(k, Math.max(0, Math.round(v)));
  return out;
}

/** Living spending per primary category in one month (YYYY-MM), actual amounts, refunds netted. */
export function spentByCategory(classified: Classified[], month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of classified) {
    if (c.tx.pending || !c.tx.date.startsWith(month)) continue;
    if (c.class !== "living_expense" && c.class !== "refund") continue;
    const k = c.tx.pfcPrimary ?? "UNCATEGORIZED";
    out.set(k, (out.get(k) ?? 0) + c.tx.amountCents);
  }
  return out;
}

export function budgetReport(opts: {
  classified: Classified[];
  /** Today, YYYY-MM-DD; the report covers this month. */
  asOf: string;
  budgets: Budget[];
  averages: Map<string, number>;
}): BudgetLine[] {
  const month = opts.asOf.slice(0, 7);
  const fraction = Number(opts.asOf.slice(8, 10)) / daysInMonth(month);
  const spent = spentByCategory(opts.classified, month);
  const budgets = new Map(opts.budgets.map((b) => [b.category, b.monthlyCents]));
  const cats = new Set([
    ...budgets.keys(),
    ...spent.keys(),
    ...[...opts.averages].filter(([, v]) => v > 0).map(([k]) => k),
  ]);
  const lines: BudgetLine[] = [];
  for (const category of cats) {
    const s = Math.max(0, spent.get(category) ?? 0);
    const avg = opts.averages.get(category) ?? 0;
    const projected = Math.round(s + avg * Math.max(0, 1 - fraction));
    const b = budgets.get(category) ?? null;
    let status: BudgetLine["status"] = "none";
    if (b !== null) status = s > b ? "over" : projected > b ? "near" : "under";
    lines.push({
      category,
      budgetCents: b,
      spentCents: s,
      averageCents: avg,
      projectedCents: projected,
      status,
    });
  }
  const rank = { over: 0, near: 1, under: 2, none: 3 };
  return lines.sort((a, b) => rank[a.status] - rank[b.status] || b.spentCents - a.spentCents);
}
