import { createHouseholdForUser, createPerson, listDebts, listTransactions, scopeFor } from "@fire/db";
import { generateKeySpec, loadKeyring } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDebtRate } from "../src/server/debts";
import type { PlaidDeps } from "../src/server/plaid/config";
import { exchangePublicToken } from "../src/server/plaid/link";
import { syncItem } from "../src/server/plaid/sync";
import { saveSpending } from "../src/server/profile";
import { planForScenario } from "../src/server/snapshot";
import { decide, setCategoryEssential, undoDecision, useMeasuredSpending } from "../src/server/spending";

let t: TestDb;
let deps: PlaidDeps;
let fake: FakePlaid;

beforeAll(async () => {
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
afterAll(async () => t.close());

describe("spending review", () => {
  it("marking a transaction one-time changes annual spending and the FI number by the expected amount", async () => {
    const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H")) };
    await createPerson(ctx.db, ctx.scope, { name: "Alex", birthMonth: 2026 * 12 + 10 - 40 * 12 });
    await exchangePublicToken(ctx, deps, fake.createPublicToken(), {
      id: "ins_fixture",
      name: "Fixture Bank",
    });
    await useMeasuredSpending(ctx, true);

    const before = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(before.issues).toEqual([]);
    expect(before.data.derivedSpending?.livingCents).toBe(25_960_00);
    const furniture = (await listTransactions(ctx.db, ctx.scope, "2025-11-01", "2026-10-31")).find(
      (x) => x.name === "HOME FURNISHINGS CO",
    )!;
    expect(
      before.data.derivedSpending?.reviewQueue.some(
        (r) => r.transactionId === furniture.id && r.flag === "one-time-candidate",
      ),
    ).toBe(true);

    const decided = await decide(ctx, { decision: "one-time", transactionId: furniture.id });
    expect(decided).toMatchObject({
      ok: true,
      data: { message: expect.stringContaining("one-time"), undo: { transactionId: furniture.id, had: "0" } },
    });
    const after = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(after.data.derivedSpending!.livingCents).toBe(before.data.derivedSpending!.livingCents - 420_000);
    expect(after.input!.spending.currentAnnual).toBe(before.input!.spending.currentAnnual - 4200);
    const a = after.scenario.assumptions;
    const expectedDrop = 4200 / a.swr / (1 - a.withdrawalTaxRate);
    expect(before.result!.levels.fi - after.result!.levels.fi).toBeCloseTo(expectedDrop, 6);
    // Reviewed: it leaves the queue.
    expect(after.data.derivedSpending!.reviewQueue.some((r) => r.transactionId === furniture.id)).toBe(false);

    // Amortizing instead counts a quarter of it.
    const spread = await decide(ctx, { decision: "amortize", years: "4", transactionId: furniture.id });
    expect(spread).toMatchObject({ ok: true, data: { undo: { had: "1", oneTime: "true" } } });
    const amortized = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(amortized.data.derivedSpending!.livingCents).toBe(
      before.data.derivedSpending!.livingCents - 420_000 + 105_000,
    );

    // Undo puts back exactly what was there: one-time, then no decision at all.
    const undo = (r: typeof spread) => (r.ok ? (r.data?.undo ?? {}) : {});
    expect(await undoDecision(ctx, undo(spread))).toEqual({ ok: true });
    const oneTimeAgain = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(oneTimeAgain.data.derivedSpending!.livingCents).toBe(
      before.data.derivedSpending!.livingCents - 420_000,
    );
    expect(await undoDecision(ctx, undo(decided))).toEqual({ ok: true });
    const restored = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(restored.data.derivedSpending!.livingCents).toBe(before.data.derivedSpending!.livingCents);
    expect(restored.data.derivedSpending!.reviewQueue.some((r) => r.transactionId === furniture.id)).toBe(
      true,
    );
    // A forged undo for another household's transaction changes nothing.
    expect(
      await undoDecision(ctx, {
        had: "1",
        transactionId: crypto.randomUUID(),
        class: "",
        essential: "",
        oneTime: "true",
        amortizeYears: "",
      }),
    ).toMatchObject({ ok: false });
  });

  it("category rules and decisions are validated and scoped", async () => {
    const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H2")) };
    expect(await decide(ctx, { decision: "one-time", transactionId: crypto.randomUUID() })).toMatchObject({
      ok: false,
    });
    expect(
      await decide(ctx, { decision: "amortize", years: "1", transactionId: crypto.randomUUID() }),
    ).toMatchObject({ ok: false });
    expect(await setCategoryEssential(ctx, "drop table", true)).toMatchObject({ ok: false });
    expect(await setCategoryEssential(ctx, "FOOD_AND_DRINK_RESTAURANT", true)).toMatchObject({
      ok: true,
      data: {
        message: expect.stringContaining("essential"),
        undo: { category: "FOOD_AND_DRINK_RESTAURANT" },
      },
    });
  });

  it("connected accounts measure spending without being asked, until the user enters their own estimate", async () => {
    const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H3")) };
    await createPerson(ctx.db, ctx.scope, { name: "Alex", birthMonth: 2026 * 12 + 10 - 40 * 12 });

    // Nothing connected and nothing entered: the plan asks for spending.
    const empty = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(empty.issues.find((i) => i.code === "no-spending")?.message).toMatch(/connect accounts/);

    await exchangePublicToken(ctx, deps, fake.createPublicToken(), {
      id: "ins_fixture",
      name: "Fixture Bank",
    });
    const auto = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(auto.issues.map((i) => i.code)).not.toContain("no-spending");
    expect(auto.data.spendingSource).toBe("plaid");
    expect(auto.input!.spending.currentAnnual).toBe(25_960);

    // An estimate the user chose and entered wins.
    expect(await saveSpending(ctx, { source: "manual", annual: "50,000", essential: "30,000" })).toEqual({
      ok: true,
    });
    const manual = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(manual.data.spendingSource).toBe("manual");
    expect(manual.input!.spending.currentAnnual).toBe(50_000);

    // And switching back to measured works as before.
    await useMeasuredSpending(ctx, true);
    const back = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(back.data.spendingSource).toBe("plaid");
    expect(back.input!.spending.currentAnnual).toBe(25_960);
  });

  it("a rate typed on the dashboard clears the 'rate needed' issue and survives the next sync", async () => {
    const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H4")) };
    await createPerson(ctx.db, ctx.scope, { name: "Alex", birthMonth: 2026 * 12 + 10 - 40 * 12 });
    const pub = fake.createPublicToken();
    fake.setLiability(fake.itemIdForPublicToken(pub), "credit", "acc_card", { aprs: [] });
    const item = await exchangePublicToken(ctx, deps, pub, { id: "ins_fixture", name: "Fixture Bank" });
    const card = (await listDebts(ctx.db, ctx.scope)).find((d) => d.kind === "credit_card")!;
    expect((await planForScenario(ctx, null, FIXTURE_AS_OF)).issues.map((i) => i.ref)).toContain(card.id);

    expect(await setDebtRate(ctx, { id: card.id, apr: "" })).toMatchObject({
      ok: false,
      fieldErrors: { apr: expect.any(String) },
    });
    expect(await setDebtRate(ctx, { id: card.id, apr: "lots" })).toMatchObject({ ok: false });
    expect(await setDebtRate(ctx, { id: card.id, apr: "140" })).toMatchObject({ ok: false });
    expect(await setDebtRate(ctx, { id: crypto.randomUUID(), apr: "20" })).toMatchObject({ ok: false });

    expect(await setDebtRate(ctx, { id: card.id, apr: "24.99%" })).toEqual({ ok: true });
    const saved = (await listDebts(ctx.db, ctx.scope)).find((d) => d.id === card.id)!;
    expect(saved.apr).toBeCloseTo(0.2499, 10);
    expect(saved.aprSource).toBe("user");
    const plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(plan.issues.map((i) => i.code)).not.toContain("unknown-apr");
    expect(plan.input!.debts.some((d) => d.id === card.id)).toBe(true);

    // Another household cannot set it.
    const other = {
      db: t.db,
      scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H5")),
    };
    expect(await setDebtRate(other, { id: card.id, apr: "1" })).toMatchObject({ ok: false });

    // The bank still reports no APR; the next sync leaves the typed rate alone.
    await syncItem(ctx, deps, item.itemId, undefined, { asOf: FIXTURE_AS_OF });
    const resynced = (await listDebts(ctx.db, ctx.scope)).find((d) => d.id === card.id)!;
    expect(resynced.apr).toBeCloseTo(0.2499, 10);
    expect(resynced.aprSource).toBe("user");
  });
});
