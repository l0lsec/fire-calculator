// Plaid REST client over fetch (runs on Workers and Node). Requests carry the
// client id and secret in the JSON body, as Plaid specifies; neither request
// bodies nor access tokens ever appear in errors or logs.
import type { z } from "zod";
import * as S from "./schemas";

export type PlaidEnv = "sandbox" | "production";

export const PLAID_BASE_URLS: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export const PLAID_VERSION = "2020-09-14";

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  /** Test seam: point at the fake Plaid API. */
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Test seam for backoff waits. */
  sleep?: (ms: number) => Promise<void>;
}

/** An error response from Plaid, with its documented error code. */
export class PlaidApiError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly errorCode: string;
  readonly displayMessage: string | null;
  readonly requestId: string | null;
  constructor(status: number, body: S.PlaidErrorBody) {
    super(`Plaid ${body.error_type}/${body.error_code}: ${body.error_message}`);
    this.name = "PlaidApiError";
    this.status = status;
    this.errorType = body.error_type;
    this.errorCode = body.error_code;
    this.displayMessage = body.display_message ?? null;
    this.requestId = body.request_id ?? null;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.errorType === "RATE_LIMIT_EXCEEDED";
  }
  /** Errors that mean the user must re-authenticate through Link update mode. */
  get needsReauth(): boolean {
    return [
      "ITEM_LOGIN_REQUIRED",
      "PENDING_EXPIRATION",
      "PENDING_DISCONNECT",
      "INVALID_CREDENTIALS",
    ].includes(this.errorCode);
  }
}

/** Plaid answered 2xx with a body that does not match the schema. */
export class PlaidSchemaError extends Error {
  readonly path: string;
  readonly issues: string[];
  constructor(path: string, issues: string[]) {
    super(`Plaid ${path} response failed validation: ${issues.slice(0, 5).join("; ")}`);
    this.name = "PlaidSchemaError";
    this.path = path;
    this.issues = issues;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LinkTokenParams {
  clientUserId: string;
  webhook?: string;
  /** Update mode: re-authenticate (or add accounts to) an existing Item. */
  accessToken?: string;
  accountSelection?: boolean;
  redirectUri?: string;
  daysRequested?: number;
}

export class PlaidClient {
  private readonly cfg: Required<Omit<PlaidConfig, "baseUrl" | "fetch" | "sleep">> & {
    baseUrl: string;
    fetch: typeof fetch;
    sleep: (ms: number) => Promise<void>;
  };

  constructor(cfg: PlaidConfig) {
    if (!cfg.clientId || !cfg.secret) throw new Error("Plaid client id and secret are required");
    this.cfg = {
      clientId: cfg.clientId,
      secret: cfg.secret,
      env: cfg.env,
      maxRetries: cfg.maxRetries ?? 4,
      baseUrl: cfg.baseUrl ?? PLAID_BASE_URLS[cfg.env],
      fetch: cfg.fetch ?? fetch.bind(globalThis),
      sleep: cfg.sleep ?? defaultSleep,
    };
  }

  get env(): PlaidEnv {
    return this.cfg.env;
  }

  async call<T extends z.ZodType>(
    path: string,
    body: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.cfg.fetch(`${this.cfg.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Plaid-Version": PLAID_VERSION },
          body: JSON.stringify({ client_id: this.cfg.clientId, secret: this.cfg.secret, ...body }),
        });
      } catch (e) {
        if (attempt >= this.cfg.maxRetries)
          throw new Error(`Plaid ${path}: network error (${(e as Error).name})`);
        await this.cfg.sleep(backoff(attempt++));
        continue;
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = null;
      }
      if (!res.ok) {
        const parsed = S.PlaidErrorBody.safeParse(json);
        const err = new PlaidApiError(
          res.status,
          parsed.success
            ? parsed.data
            : {
                error_type: "API_ERROR",
                error_code: `HTTP_${res.status}`,
                error_message: "unparseable error body",
              },
        );
        if (err.retryable && attempt < this.cfg.maxRetries) {
          await this.cfg.sleep(backoff(attempt++));
          continue;
        }
        throw err;
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new PlaidSchemaError(
          path,
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      }
      return parsed.data;
    }
  }

  linkTokenCreate(p: LinkTokenParams) {
    const body: Record<string, unknown> = {
      client_name: "FIRE Planner",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: p.clientUserId },
    };
    if (p.webhook) body.webhook = p.webhook;
    if (p.redirectUri) body.redirect_uri = p.redirectUri;
    if (p.accessToken) {
      body.access_token = p.accessToken;
      if (p.accountSelection) body.update = { account_selection_enabled: true };
    } else {
      body.products = ["transactions"];
      body.optional_products = ["liabilities", "investments"];
      body.transactions = { days_requested: p.daysRequested ?? 730 };
    }
    return this.call("/link/token/create", body, S.LinkTokenCreateResponse);
  }

  itemPublicTokenExchange(publicToken: string) {
    return this.call(
      "/item/public_token/exchange",
      { public_token: publicToken },
      S.PublicTokenExchangeResponse,
    );
  }

  itemGet(accessToken: string) {
    return this.call("/item/get", { access_token: accessToken }, S.ItemGetResponse);
  }

  accountsGet(accessToken: string) {
    return this.call("/accounts/get", { access_token: accessToken }, S.AccountsGetResponse);
  }

  transactionsSync(accessToken: string, cursor: string | null, count = 500) {
    const body: Record<string, unknown> = {
      access_token: accessToken,
      count,
      options: { include_original_description: false, personal_finance_category_version: "v2" },
    };
    if (cursor) body.cursor = cursor;
    return this.call("/transactions/sync", body, S.TransactionsSyncResponse);
  }

  liabilitiesGet(accessToken: string) {
    return this.call("/liabilities/get", { access_token: accessToken }, S.LiabilitiesGetResponse);
  }

  investmentsHoldingsGet(accessToken: string) {
    return this.call(
      "/investments/holdings/get",
      { access_token: accessToken },
      S.InvestmentsHoldingsGetResponse,
    );
  }

  itemRemove(accessToken: string) {
    return this.call("/item/remove", { access_token: accessToken }, S.ItemRemoveResponse);
  }

  webhookVerificationKeyGet(kid: string) {
    return this.call("/webhook_verification_key/get", { key_id: kid }, S.WebhookVerificationKeyGetResponse);
  }

  // ---------- Sandbox only ----------

  sandboxPublicTokenCreate(
    institutionId: string,
    opts: { overrideUsername?: string; overridePassword?: string; webhook?: string } = {},
  ) {
    this.requireSandbox();
    const options: Record<string, unknown> = {};
    if (opts.webhook) options.webhook = opts.webhook;
    if (opts.overrideUsername) options.override_username = opts.overrideUsername;
    if (opts.overridePassword) options.override_password = opts.overridePassword;
    return this.call(
      "/sandbox/public_token/create",
      {
        institution_id: institutionId,
        initial_products: ["transactions", "liabilities", "investments"],
        options,
      },
      S.SandboxPublicTokenCreateResponse,
    );
  }

  sandboxFireWebhook(accessToken: string, webhookCode: string, webhookType?: string) {
    this.requireSandbox();
    const body: Record<string, unknown> = { access_token: accessToken, webhook_code: webhookCode };
    if (webhookType) body.webhook_type = webhookType;
    return this.call("/sandbox/item/fire_webhook", body, S.SandboxFireWebhookResponse);
  }

  sandboxResetLogin(accessToken: string) {
    this.requireSandbox();
    return this.call("/sandbox/item/reset_login", { access_token: accessToken }, S.SandboxResetLoginResponse);
  }

  private requireSandbox() {
    if (this.cfg.env !== "sandbox") throw new Error("sandbox endpoints are unavailable outside sandbox");
  }
}

/** Exponential backoff with full jitter: 0..min(8s, 250ms * 2^attempt). */
export function backoff(attempt: number, rand: () => number = Math.random): number {
  return Math.floor(rand() * Math.min(8000, 250 * 2 ** attempt));
}
