import { existsSync, readdirSync, readFileSync } from "node:fs";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  backoff,
  cachedKeyFetcher,
  PlaidApiError,
  PlaidClient,
  PlaidSchemaError,
  sha256Hex,
  verifyWebhook,
  WebhookVerificationError,
} from "../src";
import { FakePlaid } from "../src/fake";
import * as S from "../src/schemas";

const noSleep = async () => {};

function clientFor(fake: FakePlaid, over: Partial<ConstructorParameters<typeof PlaidClient>[0]> = {}) {
  return new PlaidClient({
    clientId: fake.clientId,
    secret: fake.secret,
    env: "sandbox",
    baseUrl: "https://fake.plaid.test",
    fetch: fake.fetch,
    sleep: noSleep,
    ...over,
  });
}

describe("schemas", () => {
  it("every endpoint's response parses (fake responses shaped like Plaid's)", async () => {
    const fake = new FakePlaid();
    const c = clientFor(fake);
    await c.linkTokenCreate({ clientUserId: "user-1", webhook: "https://example.test/hook" });
    const pub = await c.sandboxPublicTokenCreate("ins_fixture");
    const { access_token } = await c.itemPublicTokenExchange(pub.public_token);
    await c.itemGet(access_token);
    const accounts = await c.accountsGet(access_token);
    expect(accounts.accounts).toHaveLength(8);
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const page = await c.transactionsSync(access_token, cursor, 100);
      total += page.added.length;
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    expect(total).toBeGreaterThan(200);
    const liab = await c.liabilitiesGet(access_token);
    expect(liab.liabilities.mortgage?.[0]?.next_monthly_payment).toBe(2450);
    const hold = await c.investmentsHoldingsGet(access_token);
    expect(hold.holdings.length).toBe(4);
    await c.webhookVerificationKeyGet("fake-kid-1");
    await c.itemRemove(access_token);
  });

  it("recorded Sandbox responses parse, when recorded", () => {
    const dir = new URL("./recorded/", import.meta.url);
    if (!existsSync(dir)) return;
    const map: Record<string, { safeParse: (x: unknown) => { success: boolean } }> = {
      "link_token_create.json": S.LinkTokenCreateResponse,
      "item_public_token_exchange.json": S.PublicTokenExchangeResponse,
      "item_get.json": S.ItemGetResponse,
      "accounts_get.json": S.AccountsGetResponse,
      "transactions_sync.json": S.TransactionsSyncResponse,
      "liabilities_get.json": S.LiabilitiesGetResponse,
      "investments_holdings_get.json": S.InvestmentsHoldingsGetResponse,
      "webhook_verification_key_get.json": S.WebhookVerificationKeyGetResponse,
      "item_remove.json": S.ItemRemoveResponse,
    };
    for (const f of readdirSync(dir)) {
      const schema = map[f];
      if (!schema) continue;
      const res = schema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
      expect(res.success, f).toBe(true);
    }
  });

  it("a response missing a required field fails validation", async () => {
    const fake = new FakePlaid();
    const c = clientFor(fake, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            added: [
              {
                transaction_id: "t",
                account_id: "a",
                iso_currency_code: "USD",
                date: "2026-01-01",
                authorized_date: null,
                name: "x",
                pending: false,
              },
            ],
            modified: [],
            removed: [],
            next_cursor: "c1",
            has_more: false,
            request_id: "r",
          }),
          { status: 200 },
        ),
    });
    await expect(c.transactionsSync("access-x", null)).rejects.toBeInstanceOf(PlaidSchemaError);
    await expect(c.transactionsSync("access-x", null)).rejects.toThrow(/added\.0\.amount/);
  });
});

describe("client errors and retries", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    let n = 0;
    const waits: number[] = [];
    const c = new PlaidClient({
      clientId: "id",
      secret: "s",
      env: "sandbox",
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () => {
        n++;
        if (n === 1)
          return new Response(
            JSON.stringify({
              error_type: "RATE_LIMIT_EXCEEDED",
              error_code: "TRANSACTIONS_LIMIT",
              error_message: "slow down",
            }),
            { status: 429 },
          );
        if (n === 2) return new Response("oops", { status: 502 });
        return new Response(JSON.stringify({ request_id: "r" }), { status: 200 });
      },
    });
    await expect(c.itemRemove("access-x")).resolves.toEqual({ request_id: "r" });
    expect(n).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("gives up after maxRetries and surfaces the Plaid error code", async () => {
    const c = new PlaidClient({
      clientId: "id",
      secret: "s",
      env: "sandbox",
      maxRetries: 2,
      sleep: noSleep,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error_type: "API_ERROR",
            error_code: "INTERNAL_SERVER_ERROR",
            error_message: "x",
          }),
          { status: 500 },
        ),
    });
    const e = await c.itemRemove("access-x").catch((x) => x);
    expect(e).toBeInstanceOf(PlaidApiError);
    expect((e as PlaidApiError).errorCode).toBe("INTERNAL_SERVER_ERROR");
  });

  it("ITEM_LOGIN_REQUIRED is not retried and asks for re-auth; errors never echo secrets or tokens", async () => {
    const fake = new FakePlaid();
    const c = clientFor(fake);
    const pub = await c.sandboxPublicTokenCreate("ins_fixture");
    const { access_token, item_id } = await c.itemPublicTokenExchange(pub.public_token);
    fake.setItemError(item_id, "ITEM_LOGIN_REQUIRED");
    const before = fake.calls.get("/accounts/get") ?? 0;
    const e = (await c.accountsGet(access_token).catch((x) => x)) as PlaidApiError;
    expect(e.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(e.needsReauth).toBe(true);
    expect(e.retryable).toBe(false);
    expect(fake.calls.get("/accounts/get")).toBe(before + 1);
    expect(String(e.message)).not.toContain(access_token);
    expect(String(e.message)).not.toContain(fake.secret);
  });

  it("bad credentials are rejected", async () => {
    const fake = new FakePlaid();
    const c = clientFor(fake, { secret: "wrong" });
    const e = (await c.linkTokenCreate({ clientUserId: "u" }).catch((x) => x)) as PlaidApiError;
    expect(e.errorCode).toBe("INVALID_API_KEYS");
  });

  it("backoff is bounded full jitter", () => {
    expect(backoff(0, () => 0.999)).toBeLessThan(250);
    expect(backoff(10, () => 0.999)).toBeLessThan(8000);
    expect(backoff(3, () => 0)).toBe(0);
  });
});

describe("webhook verification", () => {
  const NOW = 1_800_000_000;

  async function setup() {
    const fake = new FakePlaid({ now: () => NOW });
    const c = clientFor(fake);
    const getKey = cachedKeyFetcher(c);
    return { fake, getKey };
  }

  it("accepts a valid signed fixture and rejects a wrong body hash, a stale iat, an unknown kid and alg none", async () => {
    const { fake, getKey } = await setup();
    const signed = await fake.signWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item_1",
    });
    const ok = await verifyWebhook({ body: signed.body, header: signed.header, getKey, now: () => NOW });
    expect(ok.webhook_code).toBe("SYNC_UPDATES_AVAILABLE");

    // Wrong body hash: same header, altered body.
    await expect(
      verifyWebhook({
        body: signed.body.replace("item_1", "item_2"),
        header: signed.header,
        getKey,
        now: () => NOW,
      }),
    ).rejects.toThrow(/body hash mismatch/);

    // Stale iat: signed 10 minutes ago.
    const stale = await fake.signWebhook({ webhook_type: "ITEM", webhook_code: "ERROR" }, { iat: NOW - 600 });
    await expect(
      verifyWebhook({ body: stale.body, header: stale.header, getKey, now: () => NOW }),
    ).rejects.toThrow(WebhookVerificationError);

    // Unknown kid.
    const unknown = await fake.signWebhook({ webhook_type: "ITEM", webhook_code: "ERROR" }, { kid: "nope" });
    await expect(
      verifyWebhook({ body: unknown.body, header: unknown.header, getKey, now: () => NOW }),
    ).rejects.toThrow(/unknown kid/);

    // alg: none (unsigned token claiming the right hash).
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const noneToken = `${enc({ alg: "none", kid: "fake-kid-1" })}.${enc({ iat: NOW, request_body_sha256: await sha256Hex(signed.body) })}.`;
    await expect(
      verifyWebhook({ body: signed.body, header: noneToken, getKey, now: () => NOW }),
    ).rejects.toThrow(/unexpected alg/);

    // Missing header.
    await expect(verifyWebhook({ body: signed.body, header: null, getKey, now: () => NOW })).rejects.toThrow(
      /missing/,
    );
  });

  it("rejects a token signed by a different key under the right kid, and an expired key", async () => {
    const { fake, getKey } = await setup();
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const { privateKey } = await generateKeyPair("ES256");
    const forged = await new SignJWT({ request_body_sha256: await sha256Hex(body) })
      .setProtectedHeader({ alg: "ES256", kid: "fake-kid-1" })
      .setIssuedAt(NOW)
      .sign(privateKey);
    await expect(verifyWebhook({ body, header: forged, getKey, now: () => NOW })).rejects.toThrow(
      /signature/,
    );

    const { publicKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    const expiredKey = async () => ({
      alg: "ES256",
      crv: String(jwk.crv),
      kid: "k",
      kty: String(jwk.kty),
      use: "sig",
      x: String(jwk.x),
      y: String(jwk.y),
      created_at: 1,
      expired_at: NOW - 1,
    });
    const signed = await fake.signWebhook({ webhook_type: "ITEM", webhook_code: "ERROR" });
    await expect(
      verifyWebhook({ body: signed.body, header: signed.header, getKey: expiredKey, now: () => NOW }),
    ).rejects.toThrow(/expired/);
  });

  it("caches verification keys by kid", async () => {
    const { fake, getKey } = await setup();
    await getKey("fake-kid-1");
    await getKey("fake-kid-1");
    expect(fake.calls.get("/webhook_verification_key/get")).toBe(1);
  });
});

describe("fake sync semantics", () => {
  it("paginates, reports mutation during pagination, and recovers from the saved cursor", async () => {
    const fake = new FakePlaid();
    const c = clientFor(fake);
    const pub = await c.sandboxPublicTokenCreate("ins_fixture");
    const { access_token, item_id } = await c.itemPublicTokenExchange(pub.public_token);
    const first = await c.transactionsSync(access_token, null, 50);
    expect(first.has_more).toBe(true);
    fake.armMutationDuringPagination(item_id);
    const e = (await c
      .transactionsSync(access_token, first.next_cursor, 50)
      .catch((x) => x)) as PlaidApiError;
    expect(e.errorCode).toBe("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
    // Restarting from the cursor saved before the loop works.
    const again = await c.transactionsSync(access_token, null, 500);
    expect(again.added.length).toBeGreaterThan(0);
  });
});
