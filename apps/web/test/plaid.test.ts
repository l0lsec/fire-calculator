import {
  countHouseholdRows,
  createHouseholdForUser,
  getItem,
  listAccounts,
  listDebts,
  listHoldings,
  listItems,
  listTransactions,
  scopeFor,
  updateDebt,
} from "@fire/db";
import { generateKeySpec, loadKeyring, open, tokenAad } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { FakePlaid, FIXTURE_AS_OF } from "@fire/plaid/fake";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlaidDeps } from "../src/server/plaid/config";
import { deleteAllData, disconnectItem, itemsForDisplay } from "../src/server/plaid/items";
import { exchangePublicToken } from "../src/server/plaid/link";
import { bucketFor, INVESTMENT_SUBTYPE_BUCKETS } from "../src/server/plaid/mapping";
import { syncItem } from "../src/server/plaid/sync";
import { handleWebhook } from "../src/server/plaid/webhook";
import { planForScenario } from "../src/server/snapshot";

let t: TestDb;
let fake: FakePlaid;
let deps: PlaidDeps;

beforeAll(async () => {
  t = await createTestDb();
  fake = new FakePlaid();
  deps = {
    plaid: new PlaidClient({
      clientId: fake.clientId,
      secret: fake.secret,
      env: "sandbox",
      baseUrl: "http://fake.plaid.test",
      fetch: fake.fetch,
      sleep: async () => {},
    }),
    ring: await loadKeyring(generateKeySpec(1)),
    webhookUrl: "https://app.test/api/plaid/webhook",
  };
});
afterAll(async () => t.close());

async function household() {
  const id = await createHouseholdForUser(t.db, crypto.randomUUID(), "H");
  return { db: t.db, scope: scopeFor(id) };
}

async function linked() {
  const ctx = await household();
  const pub = fake.createPublicToken({ webhook: "https://app.test/api/plaid/webhook" });
  const r = await exchangePublicToken(ctx, deps, pub, { id: "ins_fixture", name: "Fixture Bank" });
  const item = (await getItem(ctx.db, ctx.scope, r.itemId))!;
  return { ctx, item, r };
}

describe("link", () => {
  it("a Link exchange stores a token that decrypts, and no response or log line contains it", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      }),
    );
    let result: Awaited<ReturnType<typeof linked>>;
    try {
      result = await linked();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const { ctx, item, r } = result;
    const token = await open(
      deps.ring,
      { ciphertext: item.accessTokenCiphertext, iv: item.accessTokenIv, keyVersion: item.keyVersion },
      tokenAad(ctx.scope.householdId, item.plaidItemId),
    );
    expect(token).toMatch(/^access-sandbox-fake-/);
    expect(item.accessTokenCiphertext).not.toContain(token);
    expect(JSON.stringify(r)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    // The first sync ran immediately (required before Plaid sends sync webhooks).
    expect(r.accounts).toBe(8);
    expect(fake.calls.get("/transactions/sync")).toBeGreaterThan(0);
    expect((await listTransactions(ctx.db, ctx.scope, "2000-01-01", "2100-01-01")).length).toBeGreaterThan(
      200,
    );
  });
});

describe("sync", () => {
  it("running sync twice yields the same rows; removed transactions are deleted; a mutation during pagination restarts cleanly", async () => {
    const { ctx, item } = await linked();
    const snapshot = async () =>
      (await listTransactions(ctx.db, ctx.scope, "2000-01-01", "2100-01-01"))
        .map((x) => `${x.plaidTransactionId}:${x.amountCents}`)
        .sort();
    const first = await snapshot();
    await syncItem(ctx, deps, item.id);
    await syncItem(ctx, deps, item.id);
    expect(await snapshot()).toEqual(first);

    // Remove one transaction and modify another at Plaid.
    fake.removeTransaction(item.plaidItemId, "tx_0010");
    fake.modifyTransaction(item.plaidItemId, "tx_0011", { amount: 999.99 });
    const r = await syncItem(ctx, deps, item.id, ["transactions"]);
    expect(r.removed).toBe(1);
    const after = await listTransactions(ctx.db, ctx.scope, "2000-01-01", "2100-01-01");
    expect(after.some((x) => x.plaidTransactionId === fake.id(item.plaidItemId, "tx_0010"))).toBe(false);
    expect(
      after.find((x) => x.plaidTransactionId === fake.id(item.plaidItemId, "tx_0011"))?.amountCents,
    ).toBe(99999);

    // Many new transactions force pagination; a mutation mid-way forces a restart.
    const extra = Array.from({ length: 1200 }, (_, i) => ({
      transaction_id: `tx_extra_${i}`,
      account_id: "acc_card",
      amount: 1,
      iso_currency_code: "USD",
      date: "2026-11-02",
      authorized_date: null,
      name: "SMALL",
      merchant_name: null,
      pending: false,
      personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
    }));
    fake.addTransactions(item.plaidItemId, extra);
    fake.armMutationDuringPagination(item.plaidItemId);
    const before = fake.calls.get("/transactions/sync") ?? 0;
    await syncItem(ctx, deps, item.id, ["transactions"]);
    expect((fake.calls.get("/transactions/sync") ?? 0) - before).toBeGreaterThan(3);
    const final = await listTransactions(ctx.db, ctx.scope, "2000-01-01", "2100-01-01");
    expect(final.filter((x) => x.plaidTransactionId.startsWith("tx_extra_"))).toHaveLength(1200);
    expect(new Set(final.map((x) => x.plaidTransactionId)).size).toBe(final.length);
  });
});

describe("webhooks", () => {
  it("a verified SYNC_UPDATES_AVAILABLE brings new rows; unsigned and replayed requests are refused", async () => {
    const { ctx, item } = await linked();
    fake.addTransactions(item.plaidItemId, [
      {
        transaction_id: "tx_webhook_1",
        account_id: "acc_chk",
        amount: 42,
        iso_currency_code: "USD",
        date: "2026-11-20",
        authorized_date: null,
        name: "NEW SHOP",
        merchant_name: null,
        pending: false,
        personal_finance_category: {
          primary: "GENERAL_MERCHANDISE",
          detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
        },
      },
    ]);
    const signed = await fake.signWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: item.plaidItemId,
    });

    const unsigned = await handleWebhook(t.db, deps, signed.body, null);
    expect(unsigned.status).toBe(401);
    const tampered = await handleWebhook(
      t.db,
      deps,
      signed.body.replace("TRANSACTIONS", "HOLDINGS"),
      signed.header,
    );
    expect(tampered.status).toBe(401);

    const ok = await handleWebhook(t.db, deps, signed.body, signed.header);
    expect(ok).toMatchObject({ status: 200, body: { ok: true, job: "ran" } });
    const rows = await listTransactions(ctx.db, ctx.scope, "2026-11-20", "2026-11-20");
    expect(rows.some((r) => r.plaidTransactionId === fake.id(item.plaidItemId, "tx_webhook_1"))).toBe(true);

    const replay = await handleWebhook(t.db, deps, signed.body, signed.header);
    expect(replay.body).toMatchObject({ replay: true });
  });
});

describe("mapping", () => {
  it("a user-edited APR survives a later liabilities sync while unedited fields update", async () => {
    const { ctx, item } = await linked();
    const card = (await listDebts(ctx.db, ctx.scope)).find((d) => d.kind === "credit_card")!;
    expect(card.apr).toBeCloseTo(0.2499, 10);
    expect(card.aprSource).toBe("plaid");
    await updateDebt(ctx.db, ctx.scope, card.id, { apr: 0.1999 });
    // Plaid now reports a new balance and a new APR.
    const acct = fake
      .itemByPlaidId(item.plaidItemId)!
      .data.accounts.find((a) => a.account_id === fake.id(item.plaidItemId, "acc_card"))!;
    acct.balances.current = 2222;
    fake.setLiability(item.plaidItemId, "credit", "acc_card", {
      aprs: [
        {
          apr_percentage: 27.99,
          apr_type: "purchase_apr",
          balance_subject_to_apr: 2222,
          interest_charge_amount: 0,
        },
      ],
    });
    await syncItem(ctx, deps, item.id, ["accounts", "liabilities"]);
    const after = (await listDebts(ctx.db, ctx.scope)).find((d) => d.id === card.id)!;
    expect(after.apr).toBe(0.1999);
    expect(after.aprSource).toBe("user");
    expect(after.balanceCents).toBe(222200);
  });

  it("every Plaid investment subtype maps to a bucket explicitly", () => {
    // Investment subtypes listed in plaid.com/docs/api/accounts (fetched 2026-11-25).
    const PLAID_INVESTMENT_SUBTYPES = [
      "529",
      "401a",
      "401k",
      "403B",
      "457b",
      "530a",
      "brokerage",
      "cash isa",
      "crypto exchange",
      "education savings account",
      "fhsa",
      "fixed annuity",
      "gic",
      "health reimbursement arrangement",
      "hsa",
      "ira",
      "isa",
      "keogh",
      "lif",
      "life insurance",
      "line of credit",
      "lira",
      "lrif",
      "lrsp",
      "mutual fund",
      "non-custodial wallet",
      "non-taxable brokerage account",
      "other",
      "other annuity",
      "other insurance",
      "pension",
      "prediction market",
      "prif",
      "profit sharing plan",
      "qshr",
      "rdsp",
      "resp",
      "retirement",
      "rlif",
      "roth",
      "roth 401k",
      "roth 403B",
      "roth 457b",
      "roth pension",
      "roth profit sharing plan",
      "roth thrift savings plan",
      "rrif",
      "rrsp",
      "sarsep",
      "sep ira",
      "simple ira",
      "sipp",
      "stock plan",
      "tfsa",
      "thrift savings plan",
      "trust",
      "ugma",
      "utma",
      "variable annuity",
    ];
    for (const s of PLAID_INVESTMENT_SUBTYPES) expect(() => bucketFor("investment", s), s).not.toThrow();
    expect(Object.keys(INVESTMENT_SUBTYPE_BUCKETS).sort()).toEqual([...PLAID_INVESTMENT_SUBTYPES].sort());
    // Negative control: an unknown subtype is not silently mapped by the explicit table.
    expect(() => bucketFor("investment", "made up plan")).toThrow();
    expect(bucketFor("investment", "401k")).toBe("traditional");
    expect(bucketFor("investment", "roth 401k")).toBe("roth");
    expect(bucketFor("investment", "529")).toBe("excluded");
    expect(bucketFor("depository", "savings")).toBe("cash");
    expect(bucketFor("credit", "credit card")).toBe("excluded");
  });

  it("an empty card aprs array produces a 'needs APR' task instead of 0%", async () => {
    const ctx = await household();
    const pub = fake.createPublicToken();
    // The issuer reports no APR for this card.
    fake.setLiability(fake.itemIdForPublicToken(pub), "credit", "acc_card", { aprs: [] });
    await exchangePublicToken(ctx, deps, pub, { id: "ins_fixture", name: "Fixture Bank" });
    const card = (await listDebts(ctx.db, ctx.scope)).find((d) => d.kind === "credit_card")!;
    expect(card.apr).toBeNull();
    expect(card.aprSource).toBe("unknown");
    const plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    expect(plan.issues.find((i) => i.code === "unknown-apr")?.ref).toBe(card.id);
    expect(plan.input?.debts.some((d) => d.id === card.id) ?? false).toBe(false);
  });

  it("maps mortgage escrow, student loans, holdings with cost basis, and keeps loans out of assets", async () => {
    const { ctx } = await linked();
    const debts = await listDebts(ctx.db, ctx.scope);
    const mtg = debts.find((d) => d.kind === "mortgage")!;
    expect(mtg.apr).toBeCloseTo(0.06125, 10);
    expect(mtg.escrowMonthlyCents).toBeGreaterThan(55_000);
    const rule = mtg.minPaymentRule as { type: string; amount: number };
    expect(rule.type).toBe("fixed");
    expect(Math.round(rule.amount * 100) + mtg.escrowMonthlyCents).toBe(245_000);
    expect(debts.find((d) => d.kind === "student")?.apr).toBeCloseTo(0.055, 10);
    const accounts = await listAccounts(ctx.db, ctx.scope);
    expect(accounts.find((a) => a.subtype === "401k")?.bucket).toBe("traditional");
    expect(accounts.find((a) => a.subtype === "roth")?.bucket).toBe("roth");
    expect(accounts.find((a) => a.subtype === "brokerage")?.costBasisCents).toBe(2_850_000);
    expect((await listHoldings(ctx.db, ctx.scope)).length).toBe(4);
    const plan = await planForScenario(ctx, null, FIXTURE_AS_OF);
    // Card and loans are debts, never assets.
    expect(plan.data.accounts.filter((a) => a.type === "loan" || a.type === "credit")).toHaveLength(3);
  });
});

describe("item health", () => {
  it("ITEM_LOGIN_REQUIRED flips the Item to login_required and a repaired login restores healthy", async () => {
    const { ctx, item } = await linked();
    fake.setItemError(item.plaidItemId, "ITEM_LOGIN_REQUIRED");
    const r = await syncItem(ctx, deps, item.id);
    expect(r.status).toBe("login_required");
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("login_required");
    expect((await itemsForDisplay(ctx))[0]).toMatchObject({
      needsUpdate: true,
      statusText: "Sign-in needed",
    });

    // The webhook path also marks it.
    const err = await fake.signWebhook({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: item.plaidItemId,
      error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "x" },
    });
    expect((await handleWebhook(t.db, deps, err.body, err.header)).status).toBe(200);

    // User completes update mode at Plaid; Plaid sends LOGIN_REPAIRED.
    fake.setItemError(item.plaidItemId, null);
    const repaired = await fake.signWebhook({
      webhook_type: "ITEM",
      webhook_code: "LOGIN_REPAIRED",
      item_id: item.plaidItemId,
    });
    expect((await handleWebhook(t.db, deps, repaired.body, repaired.header)).status).toBe(200);
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("healthy");
  });

  it("disconnect removes the Item at Plaid; delete-my-data leaves zero household rows", async () => {
    const { ctx, item } = await linked();
    const removeCalls = fake.calls.get("/item/remove") ?? 0;
    expect(await disconnectItem(ctx, deps, item.id)).toEqual({ ok: true });
    expect(fake.calls.get("/item/remove")).toBe(removeCalls + 1);
    expect(await listItems(ctx.db, ctx.scope)).toHaveLength(0);
    expect((await listDebts(ctx.db, ctx.scope)).length).toBe(0);

    const { ctx: c2 } = await linked();
    const before = await countHouseholdRows(c2.db, c2.scope);
    expect(before.transactions).toBeGreaterThan(0);
    const deleted = await deleteAllData(c2, deps);
    expect(deleted).toBeGreaterThan(200);
    const after = await countHouseholdRows(c2.db, c2.scope);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    const tomb = await t.pg.query<{ n: number }>(
      "select count(*)::int as n from fire.audit_tombstones where household_id = $1",
      [c2.scope.householdId],
    );
    expect(tomb.rows[0]?.n).toBe(1);
  });
});

describe("recorded Sandbox liabilities", () => {
  it("auto loans and lines of credit from the real Sandbox get their rates and payments", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const file = new URL("../../../packages/plaid/test/recorded/liabilities_get.json", import.meta.url);
    expect(existsSync(file), "run pnpm plaid:record").toBe(true);
    const { LiabilitiesGetResponse } = await import("@fire/plaid");
    const res = LiabilitiesGetResponse.parse(JSON.parse(readFileSync(file, "utf8")));
    const { debtFieldsFrom } = await import("../src/server/plaid/mapping");
    const fields = debtFieldsFrom(res.accounts, res.liabilities, "2026-11-25");
    const byKind = (k: string) => [...fields.values()].filter((f) => f.kind === k);
    const auto = byKind("auto");
    expect(auto.length).toBeGreaterThan(0);
    for (const f of auto) {
      expect(f.apr).toBeGreaterThan(0);
      expect(f.minPaymentRule).toMatchObject({ type: "fixed" });
    }
    const heloc = byKind("heloc");
    expect(heloc.length).toBeGreaterThan(0);
    for (const f of heloc) expect(f.apr).toBeGreaterThan(0);
    // Accounts Plaid reports liability details for get a rate; the one it does not
    // (the Sandbox "Business Credit Card") is left without one, so the app asks.
    const covered = new Set(
      Object.values(res.liabilities)
        .flat()
        .filter(Boolean)
        .map((x) => (x as { account_id: string | null }).account_id),
    );
    for (const [accountId, f] of fields) {
      if (covered.has(accountId)) expect(f.apr, f.name).toBeGreaterThan(0);
      else expect(f.apr, f.name).toBeUndefined();
    }
    expect([...fields.values()].some((f) => f.apr === undefined)).toBe(true);
    // Account numbers are never parsed.
    expect(JSON.stringify(res)).not.toContain("account_number");
  });
});

describe("update mode completion", () => {
  it("a login error that lingers briefly after update mode is retried before it is accepted", async () => {
    const { ctx, item } = await linked();
    fake.setItemError(item.plaidItemId, "ITEM_LOGIN_REQUIRED");
    await syncItem(ctx, deps, item.id);
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("login_required");
    const { completeUpdateMode } = await import("../src/server/plaid/items");
    // Plaid clears the error only after the first retry wait.
    let waits = 0;
    const report = await completeUpdateMode(ctx, deps, item.id, {
      waitsMs: [1, 1, 1],
      sleep: async () => {
        waits++;
        fake.setItemError(item.plaidItemId, null);
      },
    });
    expect(waits).toBe(1);
    expect(report.status).toBe("ok");
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("healthy");

    // A login that is really still broken is reported, not hidden.
    fake.setItemError(item.plaidItemId, "ITEM_LOGIN_REQUIRED");
    const stuck = await completeUpdateMode(ctx, deps, item.id, { waitsMs: [1, 1], sleep: async () => {} });
    expect(stuck.status).toBe("login_required");
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("login_required");
  });
});
