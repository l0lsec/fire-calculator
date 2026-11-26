// Take-home pay measured from connected accounts: the plan uses it unless the
// user enters their own take-home pay, and other income adds on top.
import { createHouseholdForUser, createIncomeStream, createPerson, scopeFor } from "@fire/db";
import { generateKeySpec, loadKeyring } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exchangePublicToken } from "../src/server/plaid/link";
import { setupSteps } from "../src/server/setup";
import { MEASURED_INCOME_ID, planForScenario } from "../src/server/snapshot";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

async function connectedHousehold() {
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
  const ctx = { db: t.db, scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "H")) };
  const person = await createPerson(ctx.db, ctx.scope, { name: "Sam", birthMonth: 2026 * 12 + 10 - 38 * 12 });
  await exchangePublicToken(ctx, deps, fake.createPublicToken(), { id: "ins_fixture", name: "Fixture Bank" });
  return { ctx, personId: person.id };
}

describe("measured take-home pay", () => {
  it("the plan uses the pay measured from connected accounts, and setup counts it as done", async () => {
    const { ctx } = await connectedHousehold();
    const plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    // The fixture pays 6,500 a month plus 12 of interest.
    expect(plan.data.measuredIncome?.annualCents).toBe((6500 + 12) * 12 * 100);
    expect(plan.data.incomeSource).toBe("measured");
    const measured = plan.input?.income.find((i) => i.id === MEASURED_INCOME_ID);
    expect(measured).toMatchObject({ kind: "takeHome", monthly: 6512, phase: "working" });
    expect(setupSteps(plan.data).find((s) => s.id === "income")?.done).toBe(true);
  });

  it("other income adds on top; the user's own take-home pay replaces the measured figure", async () => {
    const { ctx, personId } = await connectedHousehold();
    const base = { personId, growth: "none", startAge: null, endAge: null };
    await createIncomeStream(ctx.db, ctx.scope, {
      ...base,
      name: "Pension",
      kind: "pension",
      monthlyCents: 1_000_00,
      phase: "retired",
    });
    let plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(plan.data.incomeSource).toBe("measured");
    expect(plan.input?.income.map((i) => i.name).sort()).toEqual(["Pension", "Take-home pay (measured)"]);

    await createIncomeStream(ctx.db, ctx.scope, {
      ...base,
      name: "Salary",
      kind: "takeHome",
      monthlyCents: 5_000_00,
      phase: "working",
    });
    plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(plan.data.incomeSource).toBe("manual");
    expect(plan.input?.income.map((i) => i.name).sort()).toEqual(["Pension", "Salary"]);
  });
});
