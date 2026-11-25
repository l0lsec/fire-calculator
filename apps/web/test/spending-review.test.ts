import { createHouseholdForUser, createPerson, listTransactions, scopeFor } from "@fire/db";
import { generateKeySpec, loadKeyring } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlaidDeps } from "../src/server/plaid/config";
import { exchangePublicToken } from "../src/server/plaid/link";
import { planForScenario } from "../src/server/snapshot";
import { decide, setCategoryEssential, useMeasuredSpending } from "../src/server/spending";

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

    expect(await decide(ctx, { decision: "one-time", transactionId: furniture.id })).toEqual({ ok: true });
    const after = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(after.data.derivedSpending!.livingCents).toBe(before.data.derivedSpending!.livingCents - 420_000);
    expect(after.input!.spending.currentAnnual).toBe(before.input!.spending.currentAnnual - 4200);
    const a = after.scenario.assumptions;
    const expectedDrop = 4200 / a.swr / (1 - a.withdrawalTaxRate);
    expect(before.result!.levels.fi - after.result!.levels.fi).toBeCloseTo(expectedDrop, 6);
    // Reviewed: it leaves the queue.
    expect(after.data.derivedSpending!.reviewQueue.some((r) => r.transactionId === furniture.id)).toBe(false);

    // Amortizing instead counts a quarter of it.
    expect(await decide(ctx, { decision: "amortize", years: "4", transactionId: furniture.id })).toEqual({
      ok: true,
    });
    const amortized = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(amortized.data.derivedSpending!.livingCents).toBe(
      before.data.derivedSpending!.livingCents - 420_000 + 105_000,
    );
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
    expect(await setCategoryEssential(ctx, "FOOD_AND_DRINK_RESTAURANT", true)).toEqual({ ok: true });
  });
});
