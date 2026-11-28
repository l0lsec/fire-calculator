// The iPhone companion import: pairing, the encrypted file, category mapping,
// idempotent snapshots, removals, debts, and Apple Card payments pairing with
// the bank-side debit instead of being counted as spending.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHouseholdForUser,
  getFinancekitDevice,
  listAccounts,
  listDebts,
  listTransactions,
  scopeFor,
  upsertTransactions,
} from "@fire/db";
import { generateKeySpec, open } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { deriveSpending } from "@fire/spending";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applySnapshot, importFromIphone, pairIphone, unpairIphone } from "../src/server/financekit";
import {
  aadFor,
  decimalToCents,
  decodePairingCode,
  encodePairingCode,
  newPairing,
  openEnvelope,
  type Snapshot,
  sealEnvelope,
} from "../src/server/financekit/format";
import { categoryFor, categoryForMcc } from "../src/server/financekit/mapping";

let t: TestDb;
let dir: string;
beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEYS = generateKeySpec(1);
  t = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "fk-"));
});
afterAll(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

async function household() {
  const id = await createHouseholdForUser(t.db, crypto.randomUUID(), "H");
  return { db: t.db, scope: scopeFor(id) };
}

// Fresh Apple account ids per test: one Apple account can belong to only one household.
let CARD = crypto.randomUUID();
let CASH = crypto.randomUUID();
beforeEach(() => {
  CARD = crypto.randomUUID();
  CASH = crypto.randomUUID();
});
const tx = (id: string, over: Partial<Snapshot["transactions"][number]> = {}) => ({
  id: id.replace(/^aaaaaaaa/, CARD.slice(0, 8)),
  accountId: CARD,
  amount: "12.34",
  indicator: "debit" as const,
  description: "BLUE BOTTLE COFFEE",
  merchant: "Blue Bottle",
  mcc: 5814,
  type: "pointOfSale",
  status: "booked" as const,
  date: "2026-10-03",
  posted: "2026-10-04",
  currency: "USD",
  ...over,
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    generatedAt: "2026-11-20T12:00:00Z",
    deviceName: "Test iPhone",
    accounts: [
      {
        id: CARD,
        kind: "liability",
        displayName: "Apple Card",
        description: null,
        institution: "Apple",
        currency: "USD",
        credit: { limit: "10000", minimumNext: "29.00", nextDue: "2026-11-30", overdue: null },
      },
      {
        id: CASH,
        kind: "asset",
        displayName: "Apple Cash",
        description: null,
        institution: "Apple",
        currency: "USD",
        credit: null,
      },
    ],
    balances: [
      { accountId: CARD, kind: "booked", amount: "812.50", indicator: "debit", asOf: "2026-11-20T11:00:00Z" },
      {
        accountId: CASH,
        kind: "available",
        amount: "40.00",
        indicator: "credit",
        asOf: "2026-11-20T11:00:00Z",
      },
    ],
    transactions: [
      tx("aaaaaaaa-0000-4000-8000-000000000001"),
      tx("aaaaaaaa-0000-4000-8000-000000000002", {
        amount: "500.00",
        indicator: "credit",
        description: "ACH DEPOSIT INTERNET TRANSFER",
        merchant: null,
        mcc: null,
        type: "transfer",
        date: "2026-10-15",
        posted: "2026-10-15",
      }),
      tx("aaaaaaaa-0000-4000-8000-000000000003", { status: "pending", posted: null, date: "2026-11-19" }),
      tx("aaaaaaaa-0000-4000-8000-000000000004", { status: "rejected" }),
    ],
    ...over,
  };
}

describe("format", () => {
  it("pairing codes round-trip and malformed codes are refused", () => {
    const p = newPairing();
    const code = encodePairingCode(p.pairingId, p.key);
    expect(code).toMatch(/^fp1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    const back = decodePairingCode(`  ${code}\n`);
    expect(back?.pairingId).toBe(p.pairingId);
    expect(Buffer.from(back?.key ?? []).equals(Buffer.from(p.key))).toBe(true);
    expect(decodePairingCode(code.slice(0, -1))).toBeNull();
    expect(decodePairingCode("fp2.0123456789abcdef.x")).toBeNull();
  });

  it("an envelope opens only with its key and pairing id; tampering is detected", async () => {
    const p = newPairing();
    const env = await sealEnvelope(p.pairingId, p.key, '{"hello":1}');
    expect(await openEnvelope(env, p.key)).toBe('{"hello":1}');
    await expect(openEnvelope(env, newPairing().key)).rejects.toThrow(/did not decrypt/);
    await expect(openEnvelope({ ...env, pid: "0000000000000000" }, p.key)).rejects.toThrow(/did not decrypt/);
    const bytes = Buffer.from(env.box, "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    await expect(openEnvelope({ ...env, box: bytes.toString("base64") }, p.key)).rejects.toThrow();
    expect(aadFor(p.pairingId)).toContain(p.pairingId);
  });

  it("decimal strings become cents without float drift", () => {
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("19.99")).toBe(1999);
    expect(decimalToCents("12.345")).toBe(1235);
    expect(decimalToCents("-4.005")).toBe(-401);
    expect(decimalToCents("1000000")).toBe(100_000_000);
  });
});

describe("mapping", () => {
  it("merchant codes map to spending categories, with gas before the automotive block", () => {
    expect(categoryForMcc(5411)?.detailed).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(categoryForMcc(5542)?.detailed).toBe("TRANSPORTATION_GAS");
    expect(categoryForMcc(5533)?.detailed).toBe("GENERAL_SERVICES_AUTOMOTIVE");
    expect(categoryForMcc(3058)?.detailed).toBe("TRAVEL_FLIGHTS");
    expect(categoryForMcc(9311)?.detailed).toBe("GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT");
    expect(categoryForMcc(5999)?.primary).toBe("GENERAL_MERCHANDISE");
    expect(categoryForMcc(null)).toBeNull();
  });

  it("money into a card is a card payment; interest, refunds and Apple Cash transfers are typed", () => {
    const base = tx("aaaaaaaa-0000-4000-8000-0000000000ff");
    expect(
      categoryFor({ ...base, indicator: "credit", type: "transfer", mcc: null }, "liability")?.detailed,
    ).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    expect(categoryFor({ ...base, type: "interest", mcc: null }, "liability")?.detailed).toBe(
      "BANK_FEES_INTEREST_CHARGE",
    );
    expect(categoryFor({ ...base, indicator: "credit", type: "refund" }, "liability")?.detailed).toBe(
      "FOOD_AND_DRINK_FAST_FOOD",
    );
    expect(categoryFor({ ...base, type: "transfer", mcc: null }, "asset")?.detailed).toBe(
      "TRANSFER_OUT_OTHER_TRANSFER_OUT",
    );
    expect(categoryFor({ ...base, type: "billPayment", mcc: null }, "asset")?.detailed).toBe(
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    );
  });
});

describe("import", () => {
  it("a snapshot creates the card, its debt and transactions; re-importing changes nothing", async () => {
    const ctx = await household();
    const r1 = await applySnapshot(ctx, snapshot(), "2026-11-20");
    expect(r1).toMatchObject({ status: "imported", accounts: 2, transactions: 3, removed: 0 });
    const accts = await listAccounts(ctx.db, ctx.scope);
    const card = accts.find((a) => a.name === "Apple Card");
    const cash = accts.find((a) => a.name === "Apple Cash");
    expect(card).toMatchObject({
      source: "financekit",
      type: "credit",
      bucket: "excluded",
      currentCents: 81250,
    });
    expect(cash).toMatchObject({
      type: "depository",
      subtype: "prepaid",
      bucket: "cash",
      currentCents: 4000,
    });
    const debts = await listDebts(ctx.db, ctx.scope);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({
      kind: "credit_card",
      balanceCents: 81250,
      apr: null,
      aprSource: "unknown",
    });

    const txs = await listTransactions(ctx.db, ctx.scope, "2026-01-01", "2026-12-31");
    const byName = Object.fromEntries(txs.map((x) => [x.plaidTransactionId.slice(-1), x]));
    expect(byName["1"]).toMatchObject({
      amountCents: 1234,
      pending: false,
      pfcDetailed: "FOOD_AND_DRINK_FAST_FOOD",
    });
    expect(byName["2"]).toMatchObject({ amountCents: -50000, pfcPrimary: "LOAN_PAYMENTS" });
    expect(byName["3"]).toMatchObject({ pending: true });
    expect(byName["4"]).toBeUndefined();

    await applySnapshot(ctx, snapshot(), "2026-11-20");
    expect(await listTransactions(ctx.db, ctx.scope, "2026-01-01", "2026-12-31")).toHaveLength(3);
    expect(await listAccounts(ctx.db, ctx.scope)).toHaveLength(2);
  });

  it("a transaction that disappears from the phone (a dropped pending charge) is removed", async () => {
    const ctx = await household();
    await applySnapshot(ctx, snapshot(), "2026-11-20");
    const later = snapshot();
    later.transactions = later.transactions.filter((x) => !x.id.endsWith("03"));
    const r = await applySnapshot(ctx, later, "2026-11-21");
    expect(r.removed).toBe(1);
    const ids = (await listTransactions(ctx.db, ctx.scope, "2026-01-01", "2026-12-31")).map(
      (x) => x.plaidTransactionId,
    );
    expect(ids.some((i) => i.endsWith("3"))).toBe(false);
  });

  it("a hold that never settled is left out and removed; a recent one stays", async () => {
    const ctx = await household();
    const snap = snapshot();
    // Apple still reports some card checks from years ago as pending ($0, never posted).
    snap.transactions.unshift(
      tx("aaaaaaaa-0000-4000-8000-000000000005", {
        status: "pending",
        posted: null,
        amount: "0",
        date: "2021-04-20",
      }),
      tx("aaaaaaaa-0000-4000-8000-000000000006", { status: "authorized", posted: null, date: "2026-10-20" }),
      tx("aaaaaaaa-0000-4000-8000-000000000007", { status: "pending", posted: null, date: "2026-10-22" }),
    );
    // Rows saved before this rule existed: the oldest hold is the oldest entry the phone sends.
    const older = snapshot();
    older.transactions.unshift(snap.transactions[0]!);
    const before = await applySnapshot(ctx, older, "2021-04-21");
    expect(before.transactions).toBe(4);

    const r = await applySnapshot(ctx, snap, "2026-11-21");
    const ids = (await listTransactions(ctx.db, ctx.scope, "2021-01-01", "2026-12-31")).map((x) =>
      x.plaidTransactionId.slice(-1),
    );
    // 30 days before Nov 21 is Oct 22: the Oct 20 hold is stale, the Oct 22 one is not.
    expect(ids.sort()).toEqual(["1", "2", "3", "7"]);
    expect(r).toMatchObject({ transactions: 4, removed: 1 });
  });

  it("the bank debit that paid the Apple Card pairs with the card payment and is not spending", async () => {
    const ctx = await household();
    await applySnapshot(ctx, snapshot(), "2026-11-20");
    const accts = await listAccounts(ctx.db, ctx.scope);
    const card = accts.find((a) => a.name === "Apple Card")!;
    // A checking account (as if from Plaid) that paid the card on the same day.
    const { createManualAccount } = await import("@fire/db");
    const checking = await createManualAccount(ctx.db, ctx.scope, {
      name: "Checking",
      type: "depository",
      subtype: "checking",
      bucket: "cash",
    });
    await upsertTransactions(ctx.db, ctx.scope, [
      {
        plaidTransactionId: "bank-1",
        accountId: checking.id,
        postedDate: "2026-10-15",
        authorizedDate: null,
        amountCents: 50000,
        name: "APPLECARD GSBANK PAYMENT",
        merchant: null,
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        pending: false,
        isoCurrency: "USD",
      },
    ]);
    const all = [...accts, checking];
    const txs = await listTransactions(ctx.db, ctx.scope, "2026-01-01", "2026-12-31");
    const s = deriveSpending({
      asOf: "2026-11-20",
      accounts: all.map((a) => ({ id: a.id, type: a.type, subtype: a.subtype })),
      transactions: txs.map((x) => ({
        id: x.id,
        accountId: x.accountId,
        date: x.postedDate,
        amountCents: x.amountCents,
        name: x.name,
        merchant: x.merchant,
        pfcPrimary: x.pfcPrimary,
        pfcDetailed: x.pfcDetailed,
        pending: x.pending,
      })),
    });
    const bank = s.classified.find((c) => c.tx.name.startsWith("APPLECARD"))!;
    expect(bank.class).toBe("transfer");
    expect(bank.transferPairId).not.toBeNull();
    expect(s.reviewQueue.some((q) => q.flag === "unlinked-card-payment")).toBe(false);
    // Only the coffee counts as living spending.
    expect(s.classified.filter((c) => c.class === "living_expense").map((c) => c.tx.amountCents)).toEqual([
      1234,
    ]);
    expect(card.id).toBeTruthy();
  });

  it("pairing stores the key sealed; the file round-trips; a stale or foreign file is refused", async () => {
    const ctx = await household();
    const { code } = await pairIphone(ctx);
    const p = decodePairingCode(code)!;
    const device = (await getFinancekitDevice(ctx.db, ctx.scope))!;
    expect(device.pairingId).toBe(p.pairingId);
    expect(device.keyCiphertext).not.toContain(code.split(".")[2]);

    expect((await importFromIphone(ctx, { dir })).status).toBe("no-file");
    const file = join(dir, `${p.pairingId}.fpsync`);
    await writeFile(file, JSON.stringify(await sealEnvelope(p.pairingId, p.key, JSON.stringify(snapshot()))));
    const r = await importFromIphone(ctx, { dir, asOf: "2026-11-20" });
    expect(r).toMatchObject({ status: "imported", transactions: 3 });
    expect((await getFinancekitDevice(ctx.db, ctx.scope))?.deviceName).toBe("Test iPhone");
    expect((await importFromIphone(ctx, { dir })).status).toBe("unchanged");

    // Same pairing id, wrong key (a file planted by someone without the key).
    await writeFile(
      file,
      JSON.stringify(await sealEnvelope(p.pairingId, newPairing().key, JSON.stringify(snapshot()))),
    );
    const bad = await importFromIphone(ctx, { dir, force: true });
    expect(bad.status).toBe("error");
    expect((await getFinancekitDevice(ctx.db, ctx.scope))?.lastError).toMatch(/did not decrypt/);

    // Unpairing archives the accounts and takes the card out of the debt plan.
    await unpairIphone(ctx);
    expect(await getFinancekitDevice(ctx.db, ctx.scope)).toBeNull();
    expect((await listAccounts(ctx.db, ctx.scope)).filter((a) => a.source === "financekit")).toHaveLength(0);
    expect(await listDebts(ctx.db, ctx.scope)).toHaveLength(0);
  });

  it("one household's pairing key cannot open another household's sealed key", async () => {
    const a = await household();
    const b = await household();
    await pairIphone(a);
    const da = (await getFinancekitDevice(a.db, a.scope))!;
    const { loadKeyring } = await import("@fire/db/crypto");
    const ring = await loadKeyring(process.env.TOKEN_ENCRYPTION_KEYS);
    await expect(
      open(
        ring,
        { ciphertext: da.keyCiphertext, iv: da.keyIv, keyVersion: da.keyVersion },
        `financekit-key:${b.scope.householdId}:${da.pairingId}`,
      ),
    ).rejects.toThrow();
  });
});
