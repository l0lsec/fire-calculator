import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as repos from "../src";
import { generateKeySpec, loadKeyring, open, reseal, seal, tokenAad } from "../src/crypto";
import { type Db, type HouseholdScope, NotOwnedError, scopeFor } from "../src/db";
import { createTestDb, type TestDb } from "../src/testing";

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(async () => {
  await t.close();
});

describe("migrations", () => {
  it("apply to an empty database and re-apply as a no-op", async () => {
    const before = await t.pg.query<{ n: number }>(
      "select count(*)::int as n from fire_migrations.__drizzle_migrations",
    );
    await t.migrate();
    await t.migrate();
    const after = await t.pg.query<{ n: number }>(
      "select count(*)::int as n from fire_migrations.__drizzle_migrations",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(after.rows[0]?.n).toBeGreaterThanOrEqual(2);
    const tables = await t.pg.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'fire' order by tablename",
    );
    expect(tables.rows.length).toBe(21);
    for (const row of tables.rows) expect(row.rowsecurity).toBe(true);
  });
});

// ---------- fixtures: two fully populated households ----------

interface Seeded {
  scope: HouseholdScope;
  personId: string;
  accountId: string;
  plaidAccountId: string;
  debtId: string;
  plaidDebtId: string;
  txId: string;
  scenarioId: string;
  incomeId: string;
  contributionId: string;
  itemId: string;
  fkExternalId: string;
}

async function seed(tag: string): Promise<Seeded> {
  const userId = crypto.randomUUID();
  const householdId = await repos.createHouseholdForUser(db, userId, `Household ${tag}`);
  const scope = scopeFor(householdId);
  const person = await repos.createPerson(db, scope, { name: `Person ${tag}`, birthMonth: 1990 * 12 });
  const account = await repos.createManualAccount(db, scope, {
    name: `Checking ${tag}`,
    type: "depository",
    subtype: "checking",
    bucket: "cash",
    currentCents: 100_00,
  });
  const ring = await loadKeyring(generateKeySpec(1));
  const plaidItemId = `item-${tag}-${crypto.randomUUID()}`;
  const sealed = await seal(ring, `token-${tag}`, tokenAad(householdId, plaidItemId));
  const item = await repos.createItem(db, scope, {
    plaidItemId,
    institutionId: "ins_1",
    institutionName: "Bank",
    accessTokenCiphertext: sealed.ciphertext,
    accessTokenIv: sealed.iv,
    keyVersion: sealed.keyVersion,
  });
  const plaidAccount = await repos.upsertPlaidAccount(db, scope, item.id, {
    plaidAccountId: `acct-${tag}-${crypto.randomUUID()}`,
    name: `Card ${tag}`,
    officialName: null,
    mask: "1234",
    type: "credit",
    subtype: "credit card",
    bucket: "excluded",
    currentCents: 500_00,
    availableCents: null,
    isoCurrency: "USD",
  });
  const debt = await repos.createDebt(db, scope, {
    name: `Loan ${tag}`,
    kind: "personal",
    balanceCents: 1000_00,
    apr: 0.1,
    minPaymentRule: { type: "fixed", amount: 50 },
  });
  const plaidDebt = await repos.upsertDebtFromPlaid(db, scope, plaidAccount.id, {
    name: `Card ${tag}`,
    kind: "credit_card",
    balanceCents: 500_00,
    apr: 0.24,
  });
  await repos.upsertTransactions(db, scope, [
    {
      plaidTransactionId: `tx-${tag}-${crypto.randomUUID()}`,
      accountId: account.id,
      postedDate: "2026-01-15",
      authorizedDate: null,
      amountCents: 42_00,
      name: "Groceries",
      merchant: "Market",
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      pending: false,
      isoCurrency: "USD",
    },
  ]);
  const [tx] = await repos.listTransactions(db, scope, "2026-01-01", "2026-12-31");
  await repos.setOverride(db, scope, tx!.id, { oneTime: true });
  await repos.setCategoryRule(db, scope, "FOOD_AND_DRINK_GROCERIES", {
    class: "living_expense",
    essential: true,
  });
  await repos.recordSnapshot(db, scope, account.id, "2026-01-31", 100_00);
  await repos.replaceHoldings(db, scope, plaidAccount.id, [
    {
      securityId: `sec-${tag}`,
      ticker: "VTI",
      name: "Total",
      securityType: "etf",
      quantity: 1,
      valueCents: 250_00,
      costBasisCents: 200_00,
    },
  ]);
  const scenario = await repos.createScenario(db, scope, {
    name: "Baseline",
    isBaseline: true,
    assumptions: {},
    debtPlan: {},
  });
  const income = await repos.createIncomeStream(db, scope, {
    personId: person.id,
    name: "Pay",
    kind: "takeHome",
    monthlyCents: 5000_00,
    phase: "working",
  });
  const contribution = await repos.createContributionStream(db, scope, {
    name: "401k",
    bucket: "traditional",
    monthlyCents: 500_00,
  });
  await repos.saveFinancekitPairing(db, scope, {
    pairingId: `pid${tag}`.padEnd(16, "0").slice(0, 16),
    keyCiphertext: `ct-${tag}`,
    keyIv: `iv-${tag}`,
    keyVersion: 1,
  });
  await repos.setBudget(db, scope, "FOOD_AND_DRINK", 400_00);
  await repos.dismissAlerts(db, scope, [`hide-recurring:gym-${tag}`]);
  await repos.setAlertSettings(db, scope, { lowBalanceCents: 123_00 });
  const fkExternalId = `fk:${crypto.randomUUID()}`;
  await repos.upsertFinancekitAccount(db, scope, {
    plaidAccountId: fkExternalId,
    name: `Apple Card ${tag}`,
    officialName: null,
    mask: null,
    type: "credit",
    subtype: "credit card",
    bucket: "excluded",
    currentCents: 10_00,
    availableCents: null,
    isoCurrency: "USD",
  });
  await repos.recordSyncEvent(db, {
    householdId,
    itemId: item.id,
    kind: "test",
    payloadHash: `hash-${tag}-${crypto.randomUUID()}`,
    status: "ok",
  });
  return {
    scope,
    personId: person.id,
    accountId: account.id,
    plaidAccountId: plaidAccount.id,
    debtId: debt.id,
    plaidDebtId: plaidDebt.id,
    txId: tx!.id,
    scenarioId: scenario.id,
    incomeId: income.id,
    contributionId: contribution.id,
    itemId: item.id,
    fkExternalId,
  };
}

describe("household isolation", () => {
  let A: Seeded;
  let B: Seeded;
  beforeAll(async () => {
    A = await seed("A");
    B = await seed("B");
  });

  const own = (row: { householdId?: string | null } | null | undefined, s: Seeded) =>
    row === null || row === undefined || row.householdId === s.scope.householdId;

  // Every scoped repository function, exercised with household B's scope
  // against household A's ids. Reads must return nothing of A's; writes must
  // change nothing of A's (null / false / NotOwnedError).
  const fkDeviceOfA = async () => (await repos.getFinancekitDevice(db, A.scope))!;
  const budgetOfA = async () => (await repos.listBudgets(db, A.scope)).map((b) => b.monthlyCents);
  const stateOfA = async () =>
    (await repos.listAlertState(db, A.scope)).map((r) => [r.key, Boolean(r.dismissedAt)]);
  const probes: Record<string, () => Promise<void>> = {
    listBudgets: async () =>
      expect((await repos.listBudgets(db, B.scope)).every((r) => own(r, B))).toBe(true),
    setBudget: async () => {
      await repos.setBudget(db, B.scope, "FOOD_AND_DRINK", 1);
      await repos.setBudget(db, B.scope, "FOOD_AND_DRINK", null);
      expect(await budgetOfA()).toEqual([400_00]);
    },
    listAlertState: async () =>
      expect((await repos.listAlertState(db, B.scope)).every((r) => own(r, B))).toBe(true),
    dismissAlerts: async () => {
      await repos.dismissAlerts(db, B.scope, ["hide-recurring:gym-A"]);
      expect(await stateOfA()).toEqual([["hide-recurring:gym-A", true]]);
    },
    markAlertsNotified: async () => {
      await repos.markAlertsNotified(db, B.scope, ["hide-recurring:gym-A"]);
      expect((await repos.listAlertState(db, A.scope))[0]?.notifiedAt).toBeNull();
    },
    restoreAlerts: async () => {
      await repos.restoreAlerts(db, B.scope, ["hide-recurring:gym-A"]);
      expect(await stateOfA()).toEqual([["hide-recurring:gym-A", true]]);
    },
    getAlertSettings: async () =>
      expect((await repos.getAlertSettings(db, B.scope)).householdId).toBe(B.scope.householdId),
    setAlertSettings: async () => {
      await repos.setAlertSettings(db, B.scope, { lowBalanceCents: 1 });
      expect((await repos.getAlertSettings(db, A.scope)).lowBalanceCents).toBe(123_00);
    },
    getFinancekitDevice: async () => expect(own(await repos.getFinancekitDevice(db, B.scope), B)).toBe(true),
    updateFinancekitDevice: async () => {
      await repos.updateFinancekitDevice(db, B.scope, { lastError: "B only" });
      expect((await fkDeviceOfA()).lastError).toBeNull();
    },
    deleteFinancekitDevice: async () => {
      await repos.deleteFinancekitDevice(db, B.scope);
      expect((await fkDeviceOfA()).pairingId).toBe("pidA000000000000");
    },
    saveFinancekitPairing: async () => {
      await repos.saveFinancekitPairing(db, B.scope, {
        pairingId: "0123456789abcdef",
        keyCiphertext: "x",
        keyIv: "y",
        keyVersion: 1,
      });
      expect((await fkDeviceOfA()).keyCiphertext).toBe("ct-A");
    },
    upsertFinancekitAccount: async () =>
      expect(
        repos.upsertFinancekitAccount(db, B.scope, {
          plaidAccountId: A.fkExternalId,
          name: "stolen",
          officialName: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          bucket: "excluded",
          currentCents: 0,
          availableCents: null,
          isoCurrency: "USD",
        }),
      ).rejects.toThrow(/another household/),
    archiveFinancekitAccounts: async () => {
      await repos.archiveFinancekitAccounts(db, B.scope);
      const a = (await repos.listAccounts(db, A.scope)).filter((x) => x.source === "financekit");
      expect(a.map((x) => x.name)).toEqual(["Apple Card A"]);
    },
    getHousehold: async () => expect((await repos.getHousehold(db, B.scope))?.id).toBe(B.scope.householdId),
    markOnboarded: async () => {
      await repos.markOnboarded(db, B.scope);
      expect((await repos.getHousehold(db, A.scope))?.onboardedAt).toBeNull();
    },
    renameHousehold: async () => {
      await repos.renameHousehold(db, B.scope, "B renamed");
      expect((await repos.getHousehold(db, A.scope))?.name).toBe("Household A");
    },
    listPeople: async () => expect((await repos.listPeople(db, B.scope)).every((r) => own(r, B))).toBe(true),
    createPerson: async () => {
      await expect(repos.createPerson(db, B.scope, { name: "x", birthMonth: 1 })).resolves.toBeTruthy();
      expect((await repos.listPeople(db, A.scope)).length).toBe(1);
    },
    updatePerson: async () =>
      expect(await repos.updatePerson(db, B.scope, A.personId, { name: "x" })).toBeNull(),
    deletePerson: async () => expect(await repos.deletePerson(db, B.scope, A.personId)).toBe(false),
    listIncomeStreams: async () =>
      expect((await repos.listIncomeStreams(db, B.scope)).every((r) => own(r, B))).toBe(true),
    createIncomeStream: async () =>
      expect(
        repos.createIncomeStream(db, B.scope, {
          personId: A.personId,
          name: "x",
          kind: "other",
          monthlyCents: 1,
          phase: "working",
        }),
      ).rejects.toBeInstanceOf(NotOwnedError),
    updateIncomeStream: async () =>
      expect(await repos.updateIncomeStream(db, B.scope, A.incomeId, { name: "x" })).toBeNull(),
    deleteIncomeStream: async () =>
      expect(await repos.deleteIncomeStream(db, B.scope, A.incomeId)).toBe(false),
    listContributionStreams: async () =>
      expect((await repos.listContributionStreams(db, B.scope)).every((r) => own(r, B))).toBe(true),
    createContributionStream: async () => {
      await repos.createContributionStream(db, B.scope, { name: "x", bucket: "roth", monthlyCents: 1 });
      expect((await repos.listContributionStreams(db, A.scope)).length).toBe(1);
    },
    updateContributionStream: async () =>
      expect(await repos.updateContributionStream(db, B.scope, A.contributionId, { name: "x" })).toBeNull(),
    deleteContributionStream: async () =>
      expect(await repos.deleteContributionStream(db, B.scope, A.contributionId)).toBe(false),
    getSpendingProfile: async () => expect(own(await repos.getSpendingProfile(db, B.scope), B)).toBe(true),
    setSpendingProfile: async () => {
      await repos.setSpendingProfile(db, B.scope, { manualAnnualCents: 1 });
      expect((await repos.getSpendingProfile(db, A.scope))?.manualAnnualCents).toBe(0);
    },
    listScenarios: async () =>
      expect((await repos.listScenarios(db, B.scope)).every((r) => own(r, B))).toBe(true),
    getScenario: async () => expect(await repos.getScenario(db, B.scope, A.scenarioId)).toBeNull(),
    getBaselineScenario: async () => expect(own(await repos.getBaselineScenario(db, B.scope), B)).toBe(true),
    createScenario: async () => {
      await repos.createScenario(db, B.scope, { name: "x", isBaseline: true, assumptions: {}, debtPlan: {} });
      expect((await repos.getBaselineScenario(db, A.scope))?.id).toBe(A.scenarioId);
    },
    updateScenario: async () => {
      expect(
        await repos.updateScenario(db, B.scope, A.scenarioId, { name: "x", isBaseline: true }),
      ).toBeNull();
      expect((await repos.getBaselineScenario(db, A.scope))?.id).toBe(A.scenarioId);
    },
    deleteScenario: async () => expect(await repos.deleteScenario(db, B.scope, A.scenarioId)).toBe(false),
    listAccounts: async () =>
      expect((await repos.listAccounts(db, B.scope, { includeArchived: true })).every((r) => own(r, B))).toBe(
        true,
      ),
    getAccount: async () => expect(await repos.getAccount(db, B.scope, A.accountId)).toBeNull(),
    createManualAccount: async () => {
      await repos.createManualAccount(db, B.scope, { name: "x", type: "other", bucket: "cash" });
      expect((await repos.listAccounts(db, A.scope)).length).toBe(3);
    },
    updateAccount: async () =>
      expect(await repos.updateAccount(db, B.scope, A.accountId, { name: "x" })).toBeNull(),
    deleteManualAccount: async () =>
      expect(await repos.deleteManualAccount(db, B.scope, A.accountId)).toBe(false),
    upsertPlaidAccount: async () =>
      expect(
        repos.upsertPlaidAccount(db, B.scope, A.itemId, {
          plaidAccountId: "x",
          name: "x",
          officialName: null,
          mask: null,
          type: "depository",
          subtype: null,
          bucket: "cash",
          currentCents: 0,
          availableCents: null,
          isoCurrency: "USD",
        }),
      ).rejects.toBeInstanceOf(NotOwnedError),
    recordSnapshot: async () =>
      expect(repos.recordSnapshot(db, B.scope, A.accountId, "2026-02-01", 1)).rejects.toBeInstanceOf(
        NotOwnedError,
      ),
    listSnapshots: async () =>
      expect(
        (await repos.listSnapshots(db, B.scope, "2000-01-01", "2100-01-01")).every((r) => own(r, B)),
      ).toBe(true),
    replaceHoldings: async () =>
      expect(repos.replaceHoldings(db, B.scope, A.plaidAccountId, [])).rejects.toBeInstanceOf(NotOwnedError),
    listHoldings: async () =>
      expect((await repos.listHoldings(db, B.scope)).every((r) => own(r, B))).toBe(true),
    listDebts: async () =>
      expect((await repos.listDebts(db, B.scope, { includeArchived: true })).every((r) => own(r, B))).toBe(
        true,
      ),
    getDebt: async () => expect(await repos.getDebt(db, B.scope, A.debtId)).toBeNull(),
    createDebt: async () =>
      expect(
        repos.createDebt(db, B.scope, {
          accountId: A.plaidAccountId,
          name: "x",
          kind: "other",
          balanceCents: 1,
          apr: 0.1,
          minPaymentRule: { type: "fixed", amount: 1 },
        }),
      ).rejects.toBeInstanceOf(NotOwnedError),
    updateDebt: async () => expect(await repos.updateDebt(db, B.scope, A.debtId, { name: "x" })).toBeNull(),
    deleteDebt: async () => expect(await repos.deleteDebt(db, B.scope, A.debtId)).toBe(false),
    upsertDebtFromPlaid: async () =>
      expect(
        repos.upsertDebtFromPlaid(db, B.scope, A.plaidAccountId, {
          name: "x",
          kind: "credit_card",
          balanceCents: 1,
        }),
      ).rejects.toBeInstanceOf(NotOwnedError),
    archiveDebtsForAccounts: async () => {
      await repos.archiveDebtsForAccounts(db, B.scope, [A.plaidAccountId]);
      expect((await repos.getDebt(db, A.scope, A.plaidDebtId))?.archived).toBe(false);
    },
    upsertTransactions: async () =>
      expect(
        repos.upsertTransactions(db, B.scope, [
          {
            plaidTransactionId: "x",
            accountId: A.accountId,
            postedDate: "2026-01-01",
            authorizedDate: null,
            amountCents: 1,
            name: "x",
            merchant: null,
            pfcPrimary: null,
            pfcDetailed: null,
            pending: false,
            isoCurrency: "USD",
          },
        ]),
      ).rejects.toBeInstanceOf(NotOwnedError),
    removeTransactions: async () => {
      const [a] = await repos.listTransactions(db, A.scope, "2000-01-01", "2100-01-01");
      expect(await repos.removeTransactions(db, B.scope, [a!.plaidTransactionId])).toBe(0);
    },
    listTransactions: async () =>
      expect(
        (await repos.listTransactions(db, B.scope, "2000-01-01", "2100-01-01")).every((r) => own(r, B)),
      ).toBe(true),
    getTransaction: async () => expect(await repos.getTransaction(db, B.scope, A.txId)).toBeNull(),
    setTransferPairs: async () => {
      await repos.setTransferPairs(db, B.scope, [[A.txId, B.txId]]);
      expect((await repos.getTransaction(db, A.scope, A.txId))?.transferPairId).toBeNull();
    },
    setOverride: async () =>
      expect(repos.setOverride(db, B.scope, A.txId, { oneTime: false })).rejects.toBeInstanceOf(
        NotOwnedError,
      ),
    clearOverride: async () => expect(await repos.clearOverride(db, B.scope, A.txId)).toBe(false),
    getOverride: async () => expect(await repos.getOverride(db, B.scope, A.txId)).toBeNull(),
    listOverrides: async () =>
      expect((await repos.listOverrides(db, B.scope)).every((r) => own(r, B))).toBe(true),
    listCategoryRules: async () =>
      expect((await repos.listCategoryRules(db, B.scope)).every((r) => own(r, B))).toBe(true),
    setCategoryRule: async () => {
      await repos.setCategoryRule(db, B.scope, "FOOD_AND_DRINK_GROCERIES", {
        class: "ignore",
        essential: false,
      });
      const [a] = await repos.listCategoryRules(db, A.scope);
      expect(a?.class).toBe("living_expense");
    },
    deleteCategoryRule: async () => {
      await repos.deleteCategoryRule(db, B.scope, "FOOD_AND_DRINK_GROCERIES");
      expect((await repos.listCategoryRules(db, A.scope)).length).toBe(1);
    },
    createItem: async () => {
      await repos.createItem(db, B.scope, {
        plaidItemId: `item-B2-${crypto.randomUUID()}`,
        institutionId: null,
        institutionName: null,
        accessTokenCiphertext: "x",
        accessTokenIv: "x",
        keyVersion: 1,
      });
      expect((await repos.listItems(db, A.scope)).length).toBe(1);
    },
    listItems: async () => expect((await repos.listItems(db, B.scope)).every((r) => own(r, B))).toBe(true),
    getItem: async () => expect(await repos.getItem(db, B.scope, A.itemId)).toBeNull(),
    updateItem: async () =>
      expect(await repos.updateItem(db, B.scope, A.itemId, { status: "revoked" })).toBeNull(),
    deleteItem: async () => expect(await repos.deleteItem(db, B.scope, A.itemId)).toBe(false),
    listSyncEvents: async () =>
      expect((await repos.listSyncEvents(db, B.scope)).every((r) => own(r, B))).toBe(true),
    countHouseholdRows: async () => {
      const a = await repos.countHouseholdRows(db, A.scope);
      expect(a.households).toBe(1);
    },
    purgeHousehold: async () => {
      // Purging B never touches A.
      const before = await repos.countHouseholdRows(db, A.scope);
      const other = await seed("C");
      await repos.purgeHousehold(db, other.scope, "test");
      expect(await repos.countHouseholdRows(db, A.scope)).toEqual(before);
      const after = await repos.countHouseholdRows(db, other.scope);
      expect(Object.values(after).every((n) => n === 0)).toBe(true);
    },
  };

  // Functions that are unscoped by design (bootstrap, system lookups, helpers).
  const UNSCOPED = new Set([
    "findHouseholdIdForUser",
    "createHouseholdForUser",
    "findItemByPlaidId",
    "listHealthyItemsForSync",
    "recordSyncEvent",
    "scopeFor",
    "assertOwned",
    "isUuid",
    "databaseReachable",
  ]);

  it("a cross-household read or write through every repository function touches nothing", async () => {
    const exported = Object.entries(repos)
      .filter(([, v]) => typeof v === "function" && !(v.prototype instanceof Error) && v !== NotOwnedError)
      .map(([k]) => k)
      .filter((k) => !UNSCOPED.has(k));
    const untested = exported.filter((k) => !(k in probes));
    expect(untested).toEqual([]);
    for (const [name, probe] of Object.entries(probes)) {
      try {
        await probe();
      } catch (e) {
        throw new Error(`${name}: ${(e as Error).message}`);
      }
    }
    // A's data is intact after every probe.
    expect(await repos.getAccount(db, A.scope, A.accountId)).not.toBeNull();
    expect(await repos.getDebt(db, A.scope, A.debtId)).not.toBeNull();
    expect((await repos.getItem(db, A.scope, A.itemId))?.status).toBe("healthy");
    expect((await repos.listPeople(db, A.scope))[0]?.name).toBe("Person A");
  });

  it("RLS blocks API roles even when a table privilege is granted by mistake", async () => {
    await t.pg.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      end $$;
      select fire.lock_down();
    `);
    // Locked down: no schema usage at all.
    await t.pg.exec("set role authenticated");
    await expect(t.pg.query("select * from fire.accounts")).rejects.toThrow(/permission denied/);
    await t.pg.exec("reset role");
    // A mistaken grant still yields zero rows because RLS has no permissive policy.
    await t.pg.exec(
      "grant usage on schema fire to authenticated; grant select on fire.accounts to authenticated;",
    );
    await t.pg.exec("set role authenticated");
    const rows = await t.pg.query("select * from fire.accounts");
    await t.pg.exec("reset role");
    expect(rows.rows.length).toBe(0);
    const owner = await t.pg.query<{ n: number }>("select count(*)::int as n from fire.accounts");
    expect(owner.rows[0]?.n).toBeGreaterThan(0);
    await t.pg.exec("select fire.lock_down();");
  });

  it("provenance keeps a user's APR when Plaid syncs again", async () => {
    await repos.updateDebt(db, A.scope, A.plaidDebtId, { apr: 0.199 });
    const after = await repos.upsertDebtFromPlaid(db, A.scope, A.plaidAccountId, {
      name: "Card A",
      kind: "credit_card",
      balanceCents: 777_00,
      apr: 0.29,
    });
    expect(after.apr).toBe(0.199);
    expect(after.aprSource).toBe("user");
    expect(after.balanceCents).toBe(777_00);
  });
});

describe("token encryption", () => {
  it("round-trips, rejects tampering and wrong rows, and rotates keys", async () => {
    const v1 = generateKeySpec(1);
    const ring1 = await loadKeyring(v1);
    const aad = tokenAad("11111111-1111-4111-8111-111111111111", "item-1");
    const sealed = await seal(ring1, "access-sandbox-secret-value", aad);
    expect(sealed.ciphertext).not.toContain("secret");
    expect(await open(ring1, sealed, aad)).toBe("access-sandbox-secret-value");

    // Tampered ciphertext.
    const bytes = atob(sealed.ciphertext).split("");
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    await expect(open(ring1, { ...sealed, ciphertext: btoa(bytes.join("")) }, aad)).rejects.toThrow(
      /decryption failed/,
    );
    // Same ciphertext moved to another household's row.
    await expect(
      open(ring1, sealed, tokenAad("22222222-2222-4222-8222-222222222222", "item-1")),
    ).rejects.toThrow();

    // Rotation: add version 2; old rows still open, reseal moves them to v2.
    const ring2 = await loadKeyring(`${v1},${generateKeySpec(2)}`);
    expect(ring2.current).toBe(2);
    expect(await open(ring2, sealed, aad)).toBe("access-sandbox-secret-value");
    const rotated = await reseal(ring2, sealed, aad);
    expect(rotated.keyVersion).toBe(2);
    expect(await open(ring2, rotated, aad)).toBe("access-sandbox-secret-value");
    // Once v1 is retired, only rotated rows open.
    const ring2Only = await loadKeyring(v1.replace(/^1:.*/, generateKeySpec(3)));
    await expect(open(ring2Only, sealed, aad)).rejects.toThrow();
  });

  it("rejects malformed key specs", async () => {
    await expect(loadKeyring(undefined)).rejects.toThrow();
    await expect(loadKeyring("1:short")).rejects.toThrow();
    await expect(loadKeyring("x:abc")).rejects.toThrow();
  });
});
