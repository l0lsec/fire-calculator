// Moving money to avoid an overdraft: every figure on the plan adds up, and a
// move you record is counted, can be removed, and Undo puts it back.
import { createHouseholdForUser, createPerson, listAccounts, scopeFor } from "@fire/db";
import { generateKeySpec, loadKeyring } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { type Classified, forecastCash } from "@fire/spending";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Breakdown, evaluateStep } from "../src/lib/breakdown";
import { chargesTotal } from "../src/lib/charges";
import {
  addBill,
  loadInsights,
  recordMove,
  removeMove,
  restoreMove,
  saveCushion,
} from "../src/server/insights";
import { feesPaidBreakdown, feesSavedBreakdown, movePlanBreakdown } from "../src/server/insights/breakdowns";
import type { PlaidDeps } from "../src/server/plaid/config";
import { exchangePublicToken } from "../src/server/plaid/link";

let t: TestDb;
let deps: PlaidDeps;
let fake: FakePlaid;
const pinned = process.env.FIRE_AS_OF;

beforeAll(async () => {
  process.env.FIRE_AS_OF = FIXTURE_AS_OF;
  t = await createTestDb();
  fake = new FakePlaid();
  deps = {
    plaid: new PlaidClient({
      clientId: fake.clientId,
      secret: fake.secret,
      env: "sandbox",
      baseUrl: "http://fake",
      fetch: fake.fetch,
      sleep: async () => {},
    }),
    ring: await loadKeyring(generateKeySpec(1)),
    webhookUrl: null,
  };
});
afterAll(async () => {
  if (pinned === undefined) delete process.env.FIRE_AS_OF;
  else process.env.FIRE_AS_OF = pinned;
  await t.close();
});

function expectAddsUp(b: Breakdown) {
  for (const s of b.steps) expect(evaluateStep(s)).toBeCloseTo(s.total.value, 2);
}

const addDays = (d: string, k: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

async function shortHousehold() {
  const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H")) };
  await createPerson(ctx.db, ctx.scope, { name: "Alex", birthMonth: 2026 * 12 + 10 - 40 * 12 });
  await exchangePublicToken(ctx, deps, fake.createPublicToken(), { id: "ins_fixture", name: "Fixture Bank" });
  const accounts = await listAccounts(ctx.db, ctx.scope);
  const chk = accounts.find((a) => a.subtype === "checking") as (typeof accounts)[number];
  const sav = accounts.find((a) => a.subtype === "savings") as (typeof accounts)[number];
  // Checking holds 8,300; a 10,000 bill tomorrow takes it below zero. Savings holds 22,000.
  const added = await addBill(ctx, {
    name: "Roof repair",
    amount: "10,000",
    cadence: "yearly",
    nextDate: addDays(FIXTURE_AS_OF, 1),
    accountId: chk.id,
  });
  expect(added.ok).toBe(true);
  return { ctx, chk, sav };
}

describe("a plan to avoid overdraft fees", () => {
  it("suggests a move from savings, and its plan, fees and source all add up", async () => {
    const { ctx, chk, sav } = await shortHousehold();
    const ins = await loadInsights(ctx);
    const f = ins.cash.accounts.find((a) => a.account.id === chk.id);
    expect(f?.shortfall?.date).toBe(addDays(FIXTURE_AS_OF, 1));
    const moves = ins.cash.transfers.filter((m) => m.toAccountId === chk.id);
    expect(moves).toHaveLength(1);
    const m = moves[0] as (typeof moves)[number];
    expect(m.fromAccountId).toBe(sav.id);
    // The fixture has no overdraft fees, so a typical 35 is used, once for the roof bill.
    expect(m.fee).toEqual({ perItemCents: 3_500, source: "typical", feeIds: [] });
    expect(m.overdrawn.map((i) => i.name)).toContain("Roof repair");
    expect(m.feesAvoidedCents).toBe(m.overdrawn.length * 3_500);
    expect((m.coverCents + m.paceCents) % 5_000).toBe(0);
    expect(m.cents).toBe(m.coverCents + m.paceCents);
    expect(m.byDate).toBe(FIXTURE_AS_OF);

    const names = (id: string) => (id === chk.id ? "Checking" : "Savings");
    const b = movePlanBreakdown(f as NonNullable<typeof f>, moves, names, (ids) => ins.charges.byIds(ids));
    if (!b) throw new Error("no plan breakdown");
    expectAddsUp(b);
    const total = (testId: string) => b.steps.find((s) => s.total.testId === testId)?.total.value;
    expect(total("move-low-total")).toBeCloseTo((f?.low.cents ?? 0) / 100, 2);
    expect(total("move-need-total")).toBeCloseTo(m.cents / 100, 2);
    expect(total("move-fees-total")).toBeCloseTo(m.feesAvoidedCents / 100, 2);
    // Savings' lowest point after the move stays above zero.
    const spare = b.steps.find((s) => s.title?.startsWith("Why Savings"));
    expect(spare?.total.value).toBeGreaterThanOrEqual(0);
  });

  it("records a move, counts it until it shows up, and Remove can be undone", async () => {
    const { ctx, chk, sav } = await shortHousehold();
    const plan = (await loadInsights(ctx)).cash.transfers[0];
    if (!plan) throw new Error("no plan");
    // 8,300 less the 10,000 bill leaves it below zero until pay: several charges, at most 3 a day.
    expect(plan.overdrawn.length).toBeGreaterThan(1);
    const fees = plan.feesAvoidedCents;
    const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const r = await recordMove(ctx, { fromAccountId: sav.id, toAccountId: chk.id });
    if (!r.ok) throw new Error(r.error);
    const low = (await loadInsights(ctx)).cash.accounts.find((a) => a.account.id === chk.id)?.low.cents ?? 0;
    expect(low).toBeGreaterThanOrEqual(0);
    expect(r.data?.message).toBe(
      `Counted the ${usd(plan.cents)} move. Everyday Checking's lowest point is now ${usd(low)}. About ${usd(fees)} in fees avoided.`,
    );

    const after = await loadInsights(ctx);
    const f = after.cash.accounts.find((a) => a.account.id === chk.id);
    expect(f?.shortfall).toBeNull();
    expect(after.cash.transfers).toEqual([]);
    expect(f?.items.some((i) => i.moveId)).toBe(true);
    expect(after.moves).toHaveLength(1);
    expect(after.moves[0]).toMatchObject({ status: "counted", savedCents: fees, chargedCents: 0 });
    expect(after.feesSavedCents).toBe(fees);
    const saved = feesSavedBreakdown(
      after.moves,
      () => "Checking",
      (ids) => after.charges.byIds(ids),
    ) as Breakdown;
    expectAddsUp(saved);
    expect(saved.steps[0]?.total.value).toBeCloseTo(fees / 100, 2);

    // A second tap finds nothing left to move.
    const again = await recordMove(ctx, { fromAccountId: sav.id, toAccountId: chk.id });
    expect(again).toEqual({ ok: false, error: "That move is no longer needed; reload the page." });

    // Remove, then Undo with the fields it hands back.
    const removed = await removeMove(ctx, after.moves[0]?.id as string);
    if (!removed.ok) throw new Error(removed.error);
    expect((await loadInsights(ctx)).moves).toEqual([]);
    expect(await restoreMove(ctx, removed.data?.undo ?? {})).toEqual({ ok: true });
    const back = await loadInsights(ctx);
    expect(back.moves).toHaveLength(1);
    expect(back.moves[0]).toMatchObject({
      amountCents: after.moves[0]?.amountCents,
      feesAvoidedCents: fees,
    });
    expect(back.cash.accounts.find((a) => a.account.id === chk.id)?.shortfall).toBeNull();

    // Another household cannot remove it.
    const other = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "O")) };
    expect(await removeMove(other, back.moves[0]?.id as string)).toEqual({
      ok: false,
      error: "That move is gone; reload the page.",
    });
  });

  it("uses the overdraft fee you set", async () => {
    const { ctx } = await shortHousehold();
    expect((await saveCushion(ctx, { cushion: "500", overdraftFee: "$29" })).ok).toBe(true);
    const ins = await loadInsights(ctx);
    expect(ins.settings.overdraftFeeCents).toBe(2_900);
    expect(ins.cash.transfers[0]?.fee).toEqual({ perItemCents: 2_900, source: "yours", feeIds: [] });
    // Blank goes back to the history.
    await saveCushion(ctx, { cushion: "500", overdraftFee: "" });
    expect((await loadInsights(ctx)).cash.transfers[0]?.fee.source).toBe("typical");
  });

  it("fees paid opens the fee charges, and they add up to the figure", async () => {
    const { ctx } = await shortHousehold();
    const ins = await loadInsights(ctx);
    expect(feesPaidBreakdown(ins.cash, (ids) => ins.charges.byIds(ids))).toBeNull();
    const fake = {
      ...ins.cash,
      feesCents: 7_000,
      feeIds: [] as string[],
    };
    const b = feesPaidBreakdown(fake, () => [
      { id: "a", date: "2026-06-02", name: "OVERDRAFT ITEM FEE", account: "Checking", amountCents: 3_500 },
      { id: "b", date: "2026-07-02", name: "OVERDRAFT ITEM FEE", account: "Checking", amountCents: 3_500 },
    ]) as Breakdown;
    expectAddsUp(b);
    const line = b.steps[0]?.lines[0];
    expect(chargesTotal(line?.charges ?? [])).toBe(7_000);
    expect(b.steps[0]?.total.value).toBe(70);
  });
});

describe("a business account's plan", () => {
  const pay = (date: string): Classified => ({
    tx: {
      id: `biz-${date}`,
      accountId: "biz",
      date,
      amountCents: 100_000,
      name: "INTUIT DES:PAYROLL",
      merchant: null,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      pending: false,
    },
    class: "living_expense",
    essential: false,
    category: "GENERAL_SERVICES",
    reason: "test",
    flags: [],
    transferPairId: null,
    countedCents: 100_000,
  });
  const acct = (id: string, subtype: string, business: boolean, balanceCents: number) => ({
    id,
    name: id,
    mask: null,
    type: "depository",
    subtype,
    business,
    balanceCents,
  });
  // Payroll of 1,000 on the 3rd against 500: the week from Dec 3 bottoms out at -500.
  const cash = forecastCash({
    asOf: "2026-11-26",
    accounts: [acct("biz", "checking", true, 50_000), acct("sav", "savings", false, 300_000)],
    classified: ["2026-09-03", "2026-10-03", "2026-11-03"].map(pay),
    cushionCents: 25_000,
  });

  it("covers only its week, from savings, and every step agrees", () => {
    const m = cash.transfers[0];
    expect(m).toMatchObject({ fromAccountId: "sav", toAccountId: "biz", cents: 50_000, coverDays: 7 });
    const f = cash.accounts.find((a) => a.account.id === "biz") as NonNullable<
      (typeof cash.accounts)[number]
    >;
    const b = movePlanBreakdown(
      f,
      cash.transfers,
      (id) => id,
      () => [],
    ) as Breakdown;
    expectAddsUp(b);
    const total = (testId: string) => b.steps.find((s) => s.total.testId === testId)?.total.value;
    // The walk ends at the week's deepest point, which is what the move brings back to $0.
    expect(total("move-low-total")).toBeCloseTo(-500, 2);
    expect(total("move-need-total")).toBeCloseTo(500, 2);
    expect(b.intro).toContain("Business income that does not arrive on a schedule is not counted");
  });
});
