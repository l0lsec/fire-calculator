import {
  createDebt,
  createHouseholdForUser,
  createIncomeStream,
  createManualAccount,
  createPerson,
  getBaselineScenario,
  recordSnapshot,
  scopeFor,
  setSpendingProfile,
  updateScenario,
} from "@fire/db";
import { generateKeySpec, loadKeyring } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { fiPortfolio, real } from "@fire/engine/projection";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPARE_LEVELS, compareScenarios, investVsPrepay } from "../src/server/compare";
import { exportHousehold, importHousehold, netWorthHistory, toCsv } from "../src/server/export";
import { exchangePublicToken } from "../src/server/plaid/link";
import { duplicateScenario, ensureBaseline } from "../src/server/scenarios";
import { planForScenario } from "../src/server/snapshot";
import { useMeasuredSpending } from "../src/server/spending";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

async function household() {
  return { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H")) };
}

async function manualHousehold() {
  const ctx = await household();
  const p = await createPerson(ctx.db, ctx.scope, { name: "Alex", birthMonth: 2026 * 12 + 10 - 35 * 12 });
  await createManualAccount(ctx.db, ctx.scope, {
    name: "Brokerage",
    type: "manual",
    bucket: "taxable",
    currentCents: 200_000_00,
  });
  await createIncomeStream(ctx.db, ctx.scope, {
    personId: p.id,
    name: "Pay",
    kind: "takeHome",
    monthlyCents: 8_000_00,
    phase: "working",
    growth: "raise",
  });
  await setSpendingProfile(ctx.db, ctx.scope, {
    source: "manual",
    manualAnnualCents: 60_000_00,
    manualEssentialCents: 40_000_00,
  });
  await createDebt(ctx.db, ctx.scope, {
    name: "Card",
    kind: "credit_card",
    balanceCents: 9_000_00,
    apr: 0.249,
    minPaymentRule: { type: "fixed", amount: 250 },
  });
  await createDebt(ctx.db, ctx.scope, {
    name: "Car",
    kind: "auto",
    balanceCents: 15_000_00,
    apr: 0.045,
    minPaymentRule: { type: "fixed", amount: 350 },
  });
  return ctx;
}

describe("scenario compare", () => {
  it("comparing a scenario with itself shows zero deltas everywhere", async () => {
    const ctx = await manualHousehold();
    const base = await ensureBaseline(ctx);
    const cmp = await compareScenarios(ctx, [base.id, base.id], FIXTURE_AS_OF, { mcRuns: 60 });
    expect(cmp.summaries).toHaveLength(2);
    expect(cmp.summaries[0]?.ready).toBe(true);
    const d = cmp.deltas[0]!;
    for (const l of COMPARE_LEVELS) {
      const a = cmp.summaries[0]!.months[l];
      expect(d.months[l], l).toBe(a === null ? null : 0);
    }
    expect(d.fiTarget).toBe(0);
    expect(d.totalInterest).toBe(0);
    expect(d.successRate).toBe(0);

    // A real change produces non-zero deltas (the comparison is not vacuous).
    const copy = await duplicateScenario(ctx, base.id, "Spend less");
    await updateScenario(ctx.db, ctx.scope, copy.ok && copy.data ? copy.data.id : "", {
      spendingOverrideCents: 45_000_00,
    });
    const cmp2 = await compareScenarios(
      ctx,
      [base.id, (copy as { data: { id: string } }).data.id],
      FIXTURE_AS_OF,
      { mcRuns: 60 },
    );
    expect(cmp2.deltas[0]!.fiTarget).toBeLessThan(0);
    expect(cmp2.deltas[0]!.months.fi).toBeLessThan(0);
  });

  it("prepaying a high-rate debt clears it sooner and costs less interest than investing the same dollars", async () => {
    const ctx = await manualHousehold();
    const plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    const card = plan.input!.debts.find((d) => d.kind === "credit_card")!;
    const r = investVsPrepay(plan.input!, card.id, 500);
    expect(r.prepay.debtFreeMonths!).toBeLessThan(r.invest.debtFreeMonths!);
    expect(r.prepay.totalInterest).toBeLessThan(r.invest.totalInterest);
    expect(r.fiMonthsSaved).not.toBeNull();
  });
});

describe("export and import", () => {
  it("a JSON export re-imported into an empty household reproduces the same projection", async () => {
    // Start from a connected household so the export has to flatten Plaid data.
    const fake = new FakePlaid();
    const deps = {
      plaid: new PlaidClient({
        clientId: fake.clientId,
        secret: fake.secret,
        env: "sandbox" as const,
        baseUrl: "http://fake",
        fetch: fake.fetch,
        sleep: async () => {},
      }),
      ring: await loadKeyring(generateKeySpec(1)),
      webhookUrl: null,
    };
    const ctx = await household();
    await createPerson(ctx.db, ctx.scope, { name: "Sam", birthMonth: 2026 * 12 + 10 - 38 * 12 });
    await exchangePublicToken(ctx, deps, fake.createPublicToken(), {
      id: "ins_fixture",
      name: "Fixture Bank",
    });
    await useMeasuredSpending(ctx, true);
    const baseline = (await getBaselineScenario(ctx.db, ctx.scope)) ?? (await ensureBaseline(ctx));
    await updateScenario(ctx.db, ctx.scope, baseline.id, {
      debtPlan: { strategy: "snowball", extraMonthly: 300 },
    });

    const before = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(before.input).not.toBeNull();
    const exported = await exportHousehold(ctx, FIXTURE_AS_OF);
    // Round-trip through JSON text, as a file would.
    const file = JSON.parse(JSON.stringify(exported));
    expect(JSON.stringify(file)).not.toMatch(/access-sandbox/);

    const target = await household();
    expect(await importHousehold(target, file)).toEqual({ ok: true });
    expect(await importHousehold(target, file)).toMatchObject({ ok: false });
    const after = await planForScenario(target, null, FIXTURE_AS_OF);
    expect(after.issues.map((i) => i.code)).toEqual(before.issues.map((i) => i.code));
    expect(after.result!.fiK).toBe(before.result!.fiK);
    expect(after.result!.levels.fi).toBeCloseTo(before.result!.levels.fi, 6);
    expect(after.result!.ladder.map((l) => l.reachedK)).toEqual(before.result!.ladder.map((l) => l.reachedK));
    const a = after.result!.accumulation.rows;
    const b = before.result!.accumulation.rows;
    for (let k = 0; k < b.length; k += 50)
      expect(real(a[k]!, fiPortfolio(a[k]!))).toBeCloseTo(real(b[k]!, fiPortfolio(b[k]!)), 4);
    expect(await importHousehold(target, { version: 99 })).toMatchObject({ ok: false });
  });

  it("CSV export neutralizes spreadsheet formulas and quotes correctly", () => {
    const csv = toCsv([{ name: '=HYPERLINK("x")', note: "a,b", n: 3 }]);
    expect(csv).toBe('name,note,n\n"\'=HYPERLINK(""x"")","a,b",3');
  });

  it("net worth history carries balances forward and subtracts debts", async () => {
    const ctx = await household();
    const a = await createManualAccount(ctx.db, ctx.scope, {
      name: "Cash",
      type: "depository",
      bucket: "cash",
      currentCents: 0,
    });
    const card = await createManualAccount(ctx.db, ctx.scope, {
      name: "Card",
      type: "credit",
      bucket: "excluded",
      currentCents: 0,
    });
    await recordSnapshot(ctx.db, ctx.scope, a.id, "2026-01-01", 10_000_00);
    await recordSnapshot(ctx.db, ctx.scope, card.id, "2026-01-01", 2_000_00);
    await recordSnapshot(ctx.db, ctx.scope, a.id, "2026-02-01", 12_000_00);
    const h = await netWorthHistory(ctx, "2026-01-01", "2026-12-31");
    expect(h).toEqual([
      { date: "2026-01-01", netWorthCents: 8_000_00 },
      { date: "2026-02-01", netWorthCents: 10_000_00 },
    ]);
  });
});
