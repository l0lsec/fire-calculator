import { createHouseholdForUser, getScenario, listAccounts, listDebts, scopeFor } from "@fire/db";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { EngineInput } from "@fire/engine/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveManualAccount } from "../src/server/accounts";
import { saveDebt } from "../src/server/debts";
import { saveContribution, saveIncome, savePerson, saveSpending } from "../src/server/profile";
import {
  AssumptionsForm,
  addAdjustment,
  ensureBaseline,
  readScenario,
  saveAssumptions,
} from "../src/server/scenarios";
import { planForScenario } from "../src/server/snapshot";

let t: TestDb;
let ctx: { db: TestDb["db"]; scope: ReturnType<typeof scopeFor> };

beforeAll(async () => {
  t = await createTestDb();
  const id = await createHouseholdForUser(t.db, crypto.randomUUID(), "Test");
  ctx = { db: t.db, scope: scopeFor(id) };
});
afterAll(async () => t.close());

const ok = (r: { ok: boolean }) => expect(r).toMatchObject({ ok: true });

describe("manual household", () => {
  it("a household entered by hand produces an EngineInput that passes the engine schema", async () => {
    ok(await savePerson(ctx, { name: "Alex", birth: "1994-01" }));
    const { listPeople } = await import("@fire/db");
    const [person] = await listPeople(ctx.db, ctx.scope);
    ok(
      await saveManualAccount(ctx, {
        name: "Checking",
        bucket: "cash",
        balance: "12,000",
        includeInFi: "on",
      }),
    );
    ok(
      await saveManualAccount(ctx, {
        name: "401(k)",
        bucket: "traditional",
        balance: "85000",
        includeInFi: "on",
      }),
    );
    ok(
      await saveManualAccount(ctx, {
        name: "Brokerage",
        bucket: "taxable",
        balance: "40000.50",
        costBasis: "30000",
        includeInFi: "on",
      }),
    );
    ok(await saveManualAccount(ctx, { name: "House", bucket: "excluded", balance: "450000" }));
    ok(
      await saveDebt(ctx, {
        name: "Visa",
        kind: "credit_card",
        balance: "6,500",
        apr: "24.99",
        minType: "card",
        cardFloor: "35",
        cardPct: "1",
      }),
    );
    ok(
      await saveDebt(ctx, {
        name: "Mortgage",
        kind: "mortgage",
        balance: "310000",
        apr: "6.25",
        minType: "fixed",
        minAmount: "1,910",
        escrow: "540",
      }),
    );
    ok(
      await saveIncome(ctx, {
        personId: person!.id,
        name: "Salary",
        kind: "takeHome",
        monthly: "7,800",
        growth: "raise",
        phase: "working",
      }),
    );
    ok(await saveContribution(ctx, { name: "401(k)", bucket: "traditional", monthly: "1,200" }));
    ok(await saveSpending(ctx, { source: "manual", annual: "54,000", essential: "36,000" }));

    const plan = await planForScenario(ctx, null, "2026-11-25");
    expect(plan.issues).toEqual([]);
    expect(plan.input).not.toBeNull();
    // It really is a valid engine input.
    expect(EngineInput.safeParse(plan.input).success).toBe(true);
    expect(plan.input!.accounts.find((a) => a.name === "House")?.includeInFI).toBe(false);
    expect(plan.input!.debts).toHaveLength(2);
    expect(plan.input!.debts.find((d) => d.kind === "mortgage")?.escrowMonthly).toBe(540);
    expect(plan.input!.spending.currentAnnual).toBe(54000);
    // The default retirement line (health insurance until 65) is present and named.
    expect(plan.input!.spending.retirementAdjustments[0]?.label).toMatch(/Health insurance/);
    // And the engine produces a plan with a ladder.
    expect(plan.result?.ladder.length).toBeGreaterThanOrEqual(9);
    expect(plan.result?.levels.fi).toBeGreaterThan(54000 / 0.04);
  });

  it("a debt with no rate becomes an issue, not a 0% loan", async () => {
    ok(
      await saveDebt(ctx, {
        name: "Mystery loan",
        kind: "personal",
        balance: "2,000",
        apr: "",
        minType: "fixed",
        minAmount: "100",
      }),
    );
    const plan = await planForScenario(ctx, null, "2026-11-25");
    expect(plan.issues.map((i) => i.code)).toContain("unknown-apr");
    expect(plan.input?.debts.some((d) => d.name === "Mystery loan")).toBe(false);
  });

  it("invalid input is rejected server side with field errors", async () => {
    const before = (await listAccounts(ctx.db, ctx.scope)).length;
    const neg = await saveManualAccount(ctx, { name: "Bad", bucket: "cash", balance: "-5" });
    expect(neg).toMatchObject({ ok: false, fieldErrors: { balance: expect.stringMatching(/negative/) } });
    const words = await saveManualAccount(ctx, { name: "", bucket: "nope", balance: "lots" });
    expect(Object.keys((words as { fieldErrors: object }).fieldErrors).sort()).toEqual([
      "balance",
      "bucket",
      "name",
    ]);
    expect((await listAccounts(ctx.db, ctx.scope)).length).toBe(before);

    const debtsBefore = (await listDebts(ctx.db, ctx.scope)).length;
    const highApr = await saveDebt(ctx, {
      name: "Loan",
      kind: "personal",
      balance: "100",
      apr: "150",
      minType: "fixed",
      minAmount: "10",
    });
    expect(highApr).toMatchObject({ ok: false, fieldErrors: { apr: expect.stringMatching(/between/) } });
    const negDebt = await saveDebt(ctx, {
      name: "Loan",
      kind: "personal",
      balance: "-1",
      apr: "5",
      minType: "fixed",
      minAmount: "10",
    });
    expect(negDebt).toMatchObject({ ok: false, fieldErrors: { balance: expect.any(String) } });
    const noMin = await saveDebt(ctx, {
      name: "Loan",
      kind: "personal",
      balance: "100",
      apr: "5",
      minType: "fixed",
    });
    expect(noMin).toMatchObject({ ok: false, fieldErrors: { minAmount: expect.any(String) } });
    const escrowOnCard = await saveDebt(ctx, {
      name: "Card",
      kind: "credit_card",
      balance: "100",
      apr: "20",
      minType: "fixed",
      minAmount: "25",
      escrow: "100",
    });
    expect(escrowOnCard).toMatchObject({ ok: false, fieldErrors: { escrow: expect.any(String) } });
    expect((await listDebts(ctx.db, ctx.scope)).length).toBe(debtsBefore);

    const badPerson = await savePerson(ctx, { name: "X", birth: "1990-13" });
    expect(badPerson).toMatchObject({ ok: false, fieldErrors: { birth: expect.any(String) } });
    const badSpend = await saveSpending(ctx, { source: "manual", annual: "40000", essential: "50000" });
    expect(badSpend).toMatchObject({ ok: false, fieldErrors: { essential: expect.any(String) } });
  });
});

describe("scenarios", () => {
  it("every assumption round-trips through the database and the zod schema unchanged", async () => {
    const base = await ensureBaseline(ctx);
    const form = {
      nominalReturn: "6.5",
      inflation: "2.75",
      cashReturn: "1.5",
      raiseRate: "3.25",
      swr: "3.5",
      retirementAge: "58",
      lifeExpectancy: "97",
      emergencyMonths: "4",
      fatMultiplier: "1.75",
      withdrawalTaxRate: "12",
      retireMode: "age",
      retireAge: "52",
      partTimeAnnual: "24,000",
      partTimeHealth: "3,000",
      partTimeUntil: "60",
      countGuaranteedIncome: "on",
      policy: "keepMortgage",
      strategy: "snowball",
      extraMonthly: "450",
      hybridThreshold: "8",
    };
    ok(await saveAssumptions(ctx, base.id, form));
    ok(
      await addAdjustment(ctx, base.id, { label: "Travel", annual: "6,000", fromAge: "55", untilAge: "75" }),
    );
    ok(await addAdjustment(ctx, base.id, { label: "No commute", annual: "-1,800", essential: "on" }));

    const s = readScenario((await getScenario(ctx.db, ctx.scope, base.id))!);
    expect(s.assumptions).toMatchObject({
      nominalReturn: 0.065,
      inflation: 0.0275,
      cashReturn: 0.015,
      raiseRate: 0.0325,
      swr: 0.035,
      retirementAge: 58,
      lifeExpectancy: 97,
      emergencyMonths: 4,
      fatMultiplier: 1.75,
      withdrawalTaxRate: 0.12,
      retireAt: { mode: "age", age: 52 },
      partTime: { annualNet: 24000, healthAnnual: 3000, untilAge: 60 },
      countGuaranteedIncome: true,
    });
    expect(s.policy).toBe("keepMortgage");
    expect(s.debtPlan).toMatchObject({ strategy: "snowball", extraMonthly: 450, hybridThreshold: 0.08 });
    expect(s.retirementAdjustments.map((a) => [a.label, a.annual, a.essential])).toEqual([
      ["Health insurance until Medicare", 7200, true],
      ["Travel", 6000, false],
      ["No commute", -1800, true],
    ]);
    expect(s.retirementAdjustments[1]).toMatchObject({ fromAge: 55, untilAge: 75 });

    // The form parses its own output back to the same values (no drift through formatting).
    const reparsed = AssumptionsForm.parse(form);
    expect(reparsed.swr).toBe(s.assumptions.swr);
    expect(reparsed.extraMonthly).toBe(45000);
  });

  it("rejects contradictory assumptions", async () => {
    const base = await ensureBaseline(ctx);
    const r = await saveAssumptions(ctx, base.id, {
      nominalReturn: "7",
      inflation: "3",
      cashReturn: "2",
      raiseRate: "3",
      swr: "4",
      retirementAge: "65",
      lifeExpectancy: "60",
      emergencyMonths: "6",
      fatMultiplier: "1.5",
      withdrawalTaxRate: "10",
      retireMode: "fi",
      policy: "payoffAtFI",
      strategy: "avalanche",
      extraMonthly: "0",
      hybridThreshold: "7",
    });
    expect(r).toMatchObject({ ok: false, fieldErrors: { lifeExpectancy: expect.any(String) } });
  });
});
