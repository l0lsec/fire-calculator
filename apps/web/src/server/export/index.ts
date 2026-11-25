// Export and import (BUILD_PLAN section 11, T4.4). The JSON export carries
// everything the plan needs; importing it into an empty household reproduces
// the same projection. Connected accounts import as manual ones (no tokens are
// ever exported), and spending imports as the effective figure the plan used.
import {
  createContributionStream,
  createDebt,
  createIncomeStream,
  createManualAccount,
  createPerson,
  createScenario,
  type Db,
  type HouseholdScope,
  listAccounts,
  listPeople,
  listScenarios,
  listSnapshots,
  listTransactions,
  setSpendingProfile,
} from "@fire/db";
import { z } from "zod";
import { readScenario } from "../scenarios";
import { loadHousehold, spendingBasis } from "../snapshot";
import { todayISO } from "../today";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const EXPORT_VERSION = 1;

const ExportSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  asOf: z.string(),
  people: z.array(z.object({ ref: z.string(), name: z.string(), birthMonth: z.number().int() })),
  accounts: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      subtype: z.string().nullable(),
      bucket: z.enum(["cash", "taxable", "traditional", "roth", "hsa", "excluded"]),
      includeInFi: z.boolean(),
      currentCents: z.number().int(),
      costBasisCents: z.number().int().nullable(),
      rothBasisCents: z.number().int().nullable(),
    }),
  ),
  debts: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["credit_card", "student", "mortgage", "auto", "personal", "heloc", "medical", "other"]),
      balanceCents: z.number().int(),
      apr: z.number().nullable(),
      minPaymentRule: z.unknown(),
      promoApr: z.number().nullable(),
      promoEndsMonth: z.number().int().nullable(),
      maturityDate: z.string().nullable(),
      escrowMonthlyCents: z.number().int(),
    }),
  ),
  income: z.array(
    z.object({
      personRef: z.string(),
      name: z.string(),
      kind: z.string(),
      monthlyCents: z.number().int(),
      growth: z.string(),
      phase: z.string(),
      startAge: z.number().nullable(),
      endAge: z.number().nullable(),
    }),
  ),
  contributions: z.array(
    z.object({
      name: z.string(),
      bucket: z.enum(["cash", "taxable", "traditional", "roth", "hsa", "excluded"]),
      monthlyCents: z.number().int(),
      growth: z.string(),
    }),
  ),
  spending: z.object({ annualCents: z.number().int(), essentialCents: z.number().int(), source: z.string() }),
  scenarios: z.array(
    z.object({
      name: z.string(),
      isBaseline: z.boolean(),
      assumptions: z.unknown(),
      debtPlan: z.unknown(),
      policy: z.string(),
      retirementAdjustments: z.unknown(),
      extraIncome: z.unknown(),
      spendingOverrideCents: z.number().int().nullable(),
    }),
  ),
  transactions: z
    .array(
      z.object({
        date: z.string(),
        amountCents: z.number().int(),
        name: z.string(),
        category: z.string().nullable(),
        account: z.string(),
      }),
    )
    .default([]),
});
export type HouseholdExport = z.infer<typeof ExportSchema>;

export async function exportHousehold(ctx: Ctx, asOf = todayISO()): Promise<HouseholdExport> {
  const data = await loadHousehold(ctx, asOf);
  const scenarios = await listScenarios(ctx.db, ctx.scope);
  const baseline = scenarios.find((s) => s.isBaseline) ?? scenarios[0];
  const spend = baseline
    ? spendingBasis(data, { ...readScenario(baseline), spendingOverrideCents: null })
    : { annual: 0, essential: 0, source: "manual" as const };
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const txs = await listTransactions(ctx.db, ctx.scope, "1900-01-01", "2999-12-31");
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    asOf,
    people: data.people.map((p) => ({ ref: p.id, name: p.name, birthMonth: p.birthMonth })),
    accounts: data.accounts
      .filter((a) => a.type !== "credit" && a.type !== "loan")
      .map((a) => ({
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        bucket: a.bucket,
        includeInFi: a.includeInFi,
        currentCents: a.currentCents,
        costBasisCents: a.costBasisCents,
        rothBasisCents: a.rothBasisCents,
      })),
    debts: data.debts.map((d) => ({
      name: d.name,
      kind: d.kind,
      balanceCents: d.balanceCents,
      apr: d.apr,
      minPaymentRule: d.minPaymentRule,
      promoApr: d.promoApr,
      promoEndsMonth: d.promoEndsMonth,
      maturityDate: d.maturityDate,
      escrowMonthlyCents: d.escrowMonthlyCents,
    })),
    income: data.income.map((i) => ({
      personRef: i.personId,
      name: i.name,
      kind: i.kind,
      monthlyCents: i.monthlyCents,
      growth: i.growth,
      phase: i.phase,
      startAge: i.startAge,
      endAge: i.endAge,
    })),
    contributions: data.contributions.map((c) => ({
      name: c.name,
      bucket: c.bucket,
      monthlyCents: c.monthlyCents,
      growth: c.growth,
    })),
    spending: {
      annualCents: Math.round(spend.annual * 100),
      essentialCents: Math.round(spend.essential * 100),
      source: spend.source,
    },
    scenarios: scenarios.map((s) => ({
      name: s.name,
      isBaseline: s.isBaseline,
      assumptions: s.assumptions,
      debtPlan: s.debtPlan,
      policy: s.policy,
      retirementAdjustments: s.retirementAdjustments,
      extraIncome: s.extraIncome,
      spendingOverrideCents: s.spendingOverrideCents,
    })),
    transactions: txs.map((t) => ({
      date: t.postedDate,
      amountCents: t.amountCents,
      name: t.name,
      category: t.pfcDetailed,
      account: accountName.get(t.accountId) ?? "",
    })),
  };
}

/** Import into an EMPTY household (no people, accounts or debts yet). */
export async function importHousehold(
  ctx: Ctx,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ExportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "This file is not a FIRE Planner export." };
  const x = parsed.data;
  const [people, accounts] = await Promise.all([
    listPeople(ctx.db, ctx.scope),
    listAccounts(ctx.db, ctx.scope),
  ]);
  if (people.length || accounts.length) return { ok: false, error: "Import only into an empty household." };

  const personIds = new Map<string, string>();
  for (const p of x.people)
    personIds.set(
      p.ref,
      (await createPerson(ctx.db, ctx.scope, { name: p.name, birthMonth: p.birthMonth })).id,
    );
  for (const a of x.accounts) {
    await createManualAccount(ctx.db, ctx.scope, {
      name: a.name,
      type: "manual",
      subtype: a.subtype,
      bucket: a.bucket,
      includeInFi: a.includeInFi,
      currentCents: a.currentCents,
      costBasisCents: a.costBasisCents,
      rothBasisCents: a.rothBasisCents,
    });
  }
  for (const d of x.debts) {
    await createDebt(ctx.db, ctx.scope, {
      name: d.name,
      kind: d.kind,
      balanceCents: d.balanceCents,
      apr: d.apr,
      minPaymentRule: d.minPaymentRule,
      promoApr: d.promoApr,
      promoEndsMonth: d.promoEndsMonth,
      maturityDate: d.maturityDate,
      escrowMonthlyCents: d.escrowMonthlyCents,
    });
  }
  for (const i of x.income) {
    const personId = personIds.get(i.personRef);
    if (!personId) continue;
    await createIncomeStream(ctx.db, ctx.scope, {
      personId,
      name: i.name,
      kind: i.kind,
      monthlyCents: i.monthlyCents,
      growth: i.growth,
      phase: i.phase,
      startAge: i.startAge,
      endAge: i.endAge,
    });
  }
  for (const c of x.contributions) {
    await createContributionStream(ctx.db, ctx.scope, {
      name: c.name,
      bucket: c.bucket,
      monthlyCents: c.monthlyCents,
      growth: c.growth,
    });
  }
  // Spending comes in as the effective figure the exported plan used (escrow stays on the mortgage).
  await setSpendingProfile(ctx.db, ctx.scope, {
    source: "manual",
    manualAnnualCents: x.spending.annualCents,
    manualEssentialCents: x.spending.essentialCents,
  });
  for (const s of x.scenarios) {
    await createScenario(ctx.db, ctx.scope, {
      name: s.name,
      isBaseline: s.isBaseline,
      assumptions: s.assumptions ?? {},
      debtPlan: s.debtPlan ?? {},
      policy: s.policy,
      retirementAdjustments: s.retirementAdjustments ?? [],
      extraIncome: s.extraIncome ?? [],
      spendingOverrideCents: s.spendingOverrideCents,
    });
  }
  return { ok: true };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0] as object);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

/** Net worth over time from daily balance snapshots: assets minus card and loan balances. */
export async function netWorthHistory(ctx: Ctx, from: string, to: string) {
  const [snaps, accounts] = await Promise.all([
    listSnapshots(ctx.db, ctx.scope, from, to),
    listAccounts(ctx.db, ctx.scope, { includeArchived: true }),
  ]);
  const kind = new Map(accounts.map((a) => [a.id, a.type === "credit" || a.type === "loan" ? -1 : 1]));
  const byDate = new Map<string, Map<string, number>>();
  for (const s of snaps) {
    const m = byDate.get(s.asOfDate) ?? new Map<string, number>();
    m.set(s.accountId, s.currentCents);
    byDate.set(s.asOfDate, m);
  }
  // Carry each account's last known balance forward so gaps do not look like losses.
  const last = new Map<string, number>();
  const out: { date: string; netWorthCents: number }[] = [];
  for (const date of [...byDate.keys()].sort()) {
    for (const [id, c] of byDate.get(date)!) last.set(id, c);
    let total = 0;
    for (const [id, c] of last) total += (kind.get(id) ?? 1) * c;
    out.push({ date, netWorthCents: total });
  }
  return out;
}
