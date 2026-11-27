// An in-memory fake of the Plaid API, behaviorally faithful for the endpoints
// this app uses: credentials checks, public token exchange, cursor-based
// /transactions/sync with pagination and the mutation-during-pagination error,
// Item errors (ITEM_LOGIN_REQUIRED), liabilities, holdings, item removal, and
// ES256-signed webhooks whose keys are served by /webhook_verification_key/get.
//
// It lets every sync, mapping and webhook path run deterministically in tests
// and in local development without Plaid keys. Gates that name the real
// Sandbox run against Plaid itself.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { PlaidTransaction } from "../schemas";
import { sha256Hex } from "../webhook";
import { FIXTURE_INSTITUTION, type FixtureData, fixtureData } from "./household";

export {
  CARD_MONTHLY,
  FIXTURE_ACCOUNTS,
  FIXTURE_AS_OF,
  FIXTURE_INSTITUTION,
  fixtureData,
  fixtureTransactions,
} from "./household";

type Event = { kind: "added" | "modified" | "removed"; tx: PlaidTransaction };

interface FakeItem {
  itemId: string;
  accessToken: string;
  institutionId: string;
  data: FixtureData;
  log: Event[];
  error: string | null;
  removed: boolean;
  webhook: string | null;
  armedMutation: boolean;
  /** Item number, used to make ids unique per Item. */
  n: number;
}

export interface FakeOptions {
  clientId?: string;
  secret?: string;
  /** Where fired webhooks are delivered. Defaults to fetch on the Item's webhook URL. */
  deliver?: (url: string, body: string, headers: Record<string, string>) => Promise<void>;
  /** Seconds since epoch for webhook iat; test seam. */
  now?: () => number;
}

const err = (status: number, error_type: string, error_code: string, error_message: string) =>
  new Response(
    JSON.stringify({ error_type, error_code, error_message, display_message: null, request_id: "req_fake" }),
    { status, headers: { "Content-Type": "application/json" } },
  );
const ok = (body: unknown) =>
  new Response(JSON.stringify({ ...(body as object), request_id: "req_fake" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export class FakePlaid {
  readonly clientId: string;
  readonly secret: string;
  private items = new Map<string, FakeItem>();
  private publicTokens = new Map<string, FakeItem>();
  private keys: Promise<{ kid: string; privateKey: CryptoKeyLike; jwk: Record<string, unknown> }>;
  private counter = 0;
  /** Random per instance: ids stay unique across restarts, like real Plaid. */
  private readonly run = crypto.randomUUID().slice(0, 8);
  private readonly deliver: NonNullable<FakeOptions["deliver"]>;
  private readonly now: () => number;
  /** Number of requests by path, for assertions. */
  readonly calls = new Map<string, number>();
  /** Webhooks fired, in order. */
  readonly fired: { url: string; body: string }[] = [];

  constructor(opts: FakeOptions = {}) {
    this.clientId = opts.clientId ?? "fake_client_id";
    this.secret = opts.secret ?? "fake_secret";
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.deliver =
      opts.deliver ??
      (async (url, body, headers) => {
        await fetch(url, { method: "POST", body, headers });
      });
    this.keys = (async () => {
      const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
      const jwk = await exportJWK(publicKey);
      return { kid: "fake-kid-1", privateKey, jwk };
    })();
  }

  /** A fetch implementation that serves the fake API. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    this.calls.set(url.pathname, (this.calls.get(url.pathname) ?? 0) + 1);
    if (body.client_id !== this.clientId || body.secret !== this.secret) {
      return err(400, "INVALID_INPUT", "INVALID_API_KEYS", "invalid client_id or secret provided");
    }
    return this.route(url.pathname, body);
  };

  // ---------- test controls ----------

  /**
   * Create an Item with the fixture household and return a public token.
   * Like real Plaid, account and transaction ids are unique per Item: each base
   * fixture id gets an "__<run>i<n>" suffix, where <run> is random per fake
   * instance (so restarts never reuse ids). Test helpers accept the base ids.
   */
  createPublicToken(opts: { webhook?: string; data?: FixtureData } = {}): string {
    const n = ++this.counter;
    const sfx = (id: string) => `${id}__${this.run}i${n}`;
    const base = opts.data ?? fixtureData();
    const data: FixtureData = {
      accounts: base.accounts.map((a) => ({
        ...a,
        account_id: sfx(a.account_id),
        balances: { ...a.balances },
      })),
      transactions: base.transactions.map((t) => ({
        ...t,
        transaction_id: sfx(t.transaction_id),
        account_id: sfx(t.account_id),
      })),
      liabilities: {
        credit: base.liabilities.credit.map((l) => ({
          ...(l as object),
          account_id: sfx((l as { account_id: string }).account_id),
        })),
        mortgage: base.liabilities.mortgage.map((l) => ({
          ...(l as object),
          account_id: sfx((l as { account_id: string }).account_id),
        })),
        student: base.liabilities.student.map((l) => ({
          ...(l as object),
          account_id: sfx((l as { account_id: string }).account_id),
        })),
      },
      holdings: base.holdings.map((h) => ({
        ...(h as object),
        account_id: sfx((h as { account_id: string }).account_id),
      })),
      securities: base.securities,
    };
    const item: FakeItem = {
      itemId: `item_fake_${this.run}_${n}`,
      accessToken: `${"access-"}sandbox-fake-${n}-${crypto.randomUUID()}`,
      institutionId: FIXTURE_INSTITUTION.id,
      data,
      log: [],
      error: null,
      removed: false,
      webhook: opts.webhook ?? null,
      armedMutation: false,
      n,
    };
    for (const t of item.data.transactions) item.log.push({ kind: "added", tx: t });
    this.items.set(item.accessToken, item);
    const pub = `public-sandbox-fake-${n}`;
    this.publicTokens.set(pub, item);
    return pub;
  }

  /** The Plaid item id a not-yet-exchanged public token will produce. */
  itemIdForPublicToken(pub: string): string {
    const item = this.publicTokens.get(pub);
    if (!item) throw new Error("no such public token");
    return item.itemId;
  }

  /** Per-Item id for a base fixture id ("acc_card" -> "acc_card__<run>i3"). */
  id(itemId: string, baseId: string): string {
    const item = this.itemByPlaidId(itemId);
    if (!item) throw new Error("no such item");
    return baseId.includes("__") ? baseId : `${baseId}__${this.run}i${item.n}`;
  }

  itemByPlaidId(itemId: string): FakeItem | undefined {
    for (const i of this.items.values()) if (i.itemId === itemId) return i;
    for (const i of this.publicTokens.values()) if (i.itemId === itemId) return i;
    return undefined;
  }

  setItemError(itemId: string, code: string | null) {
    const item = this.itemByPlaidId(itemId);
    if (item) item.error = code;
  }

  addTransactions(itemId: string, txs: PlaidTransaction[]) {
    const item = this.itemByPlaidId(itemId);
    if (!item) throw new Error("no such item");
    for (const raw of txs) {
      const t = {
        ...raw,
        transaction_id: this.id(itemId, raw.transaction_id),
        account_id: this.id(itemId, raw.account_id),
      };
      item.data.transactions.push(t);
      item.log.push({ kind: "added", tx: t });
    }
  }

  modifyTransaction(itemId: string, transactionId: string, patch: Partial<PlaidTransaction>) {
    const item = this.itemByPlaidId(itemId);
    const id = this.id(itemId, transactionId);
    const t = item?.data.transactions.find((x) => x.transaction_id === id);
    if (!item || !t) throw new Error("no such transaction");
    Object.assign(t, patch);
    item.log.push({ kind: "modified", tx: { ...t } });
  }

  removeTransaction(itemId: string, transactionId: string) {
    const item = this.itemByPlaidId(itemId);
    const id = this.id(itemId, transactionId);
    const t = item?.data.transactions.find((x) => x.transaction_id === id);
    if (!item || !t) throw new Error("no such transaction");
    item.data.transactions = item.data.transactions.filter((x) => x.transaction_id !== transactionId);
    item.log.push({ kind: "removed", tx: t });
  }

  /** The next paginated /transactions/sync call (one with has_more behind it) fails once, after a new change lands. */
  armMutationDuringPagination(itemId: string) {
    const item = this.itemByPlaidId(itemId);
    if (item) item.armedMutation = true;
  }

  setLiability(
    itemId: string,
    kind: "credit" | "mortgage" | "student",
    accountId: string,
    patch: Record<string, unknown>,
  ) {
    const item = this.itemByPlaidId(itemId);
    const list = item?.data.liabilities[kind] as Record<string, unknown>[] | undefined;
    const id = this.id(itemId, accountId);
    const row = list?.find((l) => l.account_id === id);
    if (!row) throw new Error("no such liability");
    Object.assign(row, patch);
  }

  /** Sign a webhook body exactly as Plaid does. */
  async signWebhook(payload: Record<string, unknown>, opts: { iat?: number; kid?: string } = {}) {
    const body = JSON.stringify(payload);
    const { privateKey, kid } = await this.keys;
    const header = await new SignJWT({ request_body_sha256: await sha256Hex(body) })
      .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? kid, typ: "JWT" })
      .setIssuedAt(opts.iat ?? this.now())
      .sign(privateKey);
    return { body, header };
  }

  async fireWebhook(
    itemId: string,
    webhook_type: string,
    webhook_code: string,
    extra: Record<string, unknown> = {},
  ) {
    const item = this.itemByPlaidId(itemId);
    if (!item?.webhook) throw new Error("item has no webhook URL");
    const signed = await this.signWebhook({
      webhook_type,
      webhook_code,
      item_id: itemId,
      environment: "sandbox",
      ...extra,
    });
    this.fired.push({ url: item.webhook, body: signed.body });
    await this.deliver(item.webhook, signed.body, {
      "Content-Type": "application/json",
      "Plaid-Verification": signed.header,
    });
  }

  // ---------- routing ----------

  private item(body: Record<string, unknown>): FakeItem | Response {
    const token = String(body.access_token ?? "");
    const item = this.items.get(token);
    if (!item || item.removed)
      return err(400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN", "could not find matching access token");
    if (item.error) return err(400, "ITEM_ERROR", item.error, "the login details of this item have changed");
    return item;
  }

  private itemObj(item: FakeItem) {
    return {
      item_id: item.itemId,
      institution_id: item.institutionId,
      webhook: item.webhook,
      error: null,
      available_products: ["investments", "liabilities"],
      billed_products: ["transactions"],
      consent_expiration_time: null,
    };
  }

  private async route(path: string, body: Record<string, unknown>): Promise<Response> {
    switch (path) {
      case "/link/token/create": {
        const user = body.user as { client_user_id?: string } | undefined;
        if (!user?.client_user_id)
          return err(400, "INVALID_REQUEST", "MISSING_FIELDS", "user.client_user_id is required");
        if (body.access_token) {
          const item = this.items.get(String(body.access_token));
          if (!item) return err(400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN", "unknown access token");
        }
        return ok({ link_token: `link-sandbox-fake-${++this.counter}`, expiration: "2099-01-01T00:00:00Z" });
      }
      case "/sandbox/public_token/create": {
        const opts = (body.options ?? {}) as { webhook?: string };
        return ok({ public_token: this.createPublicToken(opts.webhook ? { webhook: opts.webhook } : {}) });
      }
      case "/item/public_token/exchange": {
        const item = this.publicTokens.get(String(body.public_token));
        if (!item)
          return err(400, "INVALID_INPUT", "INVALID_PUBLIC_TOKEN", "could not find matching public token");
        this.publicTokens.delete(String(body.public_token));
        return ok({ access_token: item.accessToken, item_id: item.itemId });
      }
      case "/item/get": {
        const item = this.item(body);
        if (item instanceof Response) return item;
        return ok({ item: this.itemObj(item) });
      }
      case "/institutions/get_by_id": {
        if (String(body.institution_id) !== FIXTURE_INSTITUTION.id)
          return err(400, "INVALID_INPUT", "INVALID_INSTITUTION", "unknown institution");
        return ok({
          institution: {
            institution_id: FIXTURE_INSTITUTION.id,
            name: FIXTURE_INSTITUTION.name,
            url: FIXTURE_INSTITUTION.url,
          },
        });
      }
      case "/accounts/get": {
        const item = this.item(body);
        if (item instanceof Response) return item;
        return ok({ accounts: item.data.accounts, item: this.itemObj(item) });
      }
      case "/transactions/sync":
        return this.sync(body);
      case "/liabilities/get": {
        const item = this.item(body);
        if (item instanceof Response) return item;
        const ids = new Set(
          [
            ...item.data.liabilities.credit,
            ...item.data.liabilities.mortgage,
            ...item.data.liabilities.student,
          ].map((l) => (l as { account_id: string }).account_id),
        );
        return ok({
          accounts: item.data.accounts.filter((a) => ids.has(a.account_id)),
          item: this.itemObj(item),
          liabilities: item.data.liabilities,
        });
      }
      case "/investments/holdings/get": {
        const item = this.item(body);
        if (item instanceof Response) return item;
        return ok({
          accounts: item.data.accounts.filter((a) => a.type === "investment"),
          holdings: item.data.holdings,
          securities: item.data.securities,
          item: this.itemObj(item),
        });
      }
      case "/item/remove": {
        const token = String(body.access_token ?? "");
        const item = this.items.get(token);
        if (!item || item.removed)
          return err(400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN", "unknown access token");
        item.removed = true;
        return ok({});
      }
      case "/webhook_verification_key/get": {
        const { kid, jwk } = await this.keys;
        if (body.key_id !== kid)
          return err(400, "INVALID_INPUT", "INVALID_WEBHOOK_VERIFICATION_KEY_ID", "unknown key id");
        return ok({
          key: { ...jwk, alg: "ES256", kid, use: "sig", created_at: 1_700_000_000, expired_at: null },
        });
      }
      case "/sandbox/item/fire_webhook": {
        const item = this.item(body);
        if (item instanceof Response) return item;
        const code = String(body.webhook_code);
        const type = String(
          body.webhook_type ?? (code === "SYNC_UPDATES_AVAILABLE" ? "TRANSACTIONS" : "ITEM"),
        );
        await this.fireWebhook(
          item.itemId,
          type,
          code,
          code === "SYNC_UPDATES_AVAILABLE"
            ? { initial_update_complete: true, historical_update_complete: true }
            : {},
        );
        return ok({ webhook_fired: true });
      }
      case "/sandbox/item/reset_login": {
        const token = String(body.access_token ?? "");
        const item = this.items.get(token);
        if (!item) return err(400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN", "unknown access token");
        item.error = "ITEM_LOGIN_REQUIRED";
        if (item.webhook)
          await this.fireWebhook(item.itemId, "ITEM", "ERROR", {
            error: {
              error_type: "ITEM_ERROR",
              error_code: "ITEM_LOGIN_REQUIRED",
              error_message: "login required",
            },
          });
        return ok({ reset_login: true });
      }
      default:
        return err(404, "INVALID_REQUEST", "NOT_FOUND", `fake does not implement ${path}`);
    }
  }

  private sync(body: Record<string, unknown>): Response {
    const item = this.item(body);
    if (item instanceof Response) return item;
    const count = Math.min(500, Math.max(1, Number(body.count ?? 100)));
    const cursor = body.cursor ? String(body.cursor) : null;
    const start = cursor ? Number(cursor.replace(/^c/, "")) : 0;
    if (!Number.isInteger(start) || start < 0 || start > item.log.length) {
      return err(400, "INVALID_INPUT", "INVALID_CURSOR", "cursor is invalid");
    }
    // A cursor taken mid-pagination (one that was returned with has_more)
    // becomes invalid if data changes before the client finishes the loop.
    if (item.armedMutation && cursor && start < item.log.length && start > 0) {
      item.armedMutation = false;
      const t = item.data.transactions[0];
      if (t) item.log.push({ kind: "modified", tx: { ...t } });
      return err(
        400,
        "TRANSACTIONS_ERROR",
        "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        "data changed during pagination",
      );
    }
    const page = item.log.slice(start, start + count);
    const end = start + page.length;
    return ok({
      added: page.filter((e) => e.kind === "added").map((e) => e.tx),
      modified: page.filter((e) => e.kind === "modified").map((e) => e.tx),
      removed: page
        .filter((e) => e.kind === "removed")
        .map((e) => ({ transaction_id: e.tx.transaction_id, account_id: e.tx.account_id })),
      next_cursor: `c${end}`,
      has_more: end < item.log.length,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
    });
  }
}

type CryptoKeyLike = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
