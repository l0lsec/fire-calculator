// Plaid webhook verification (BUILD_PLAN section 5).
//
// The Plaid-Verification header is a JWT signed with ES256. We:
//   1. accept only alg ES256 (never "none" or HMAC algs) with a key id;
//   2. fetch the JWK for that kid from /webhook_verification_key/get (cached),
//      refusing keys Plaid has expired;
//   3. verify the signature and that iat is no older than 5 minutes;
//   4. compare the claim request_body_sha256 with the SHA-256 of the raw body,
//      in constant time.
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import type { PlaidClient } from "./client";
import { type WebhookKey, WebhookPayload } from "./schemas";

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`webhook rejected: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

export type KeyFetcher = (kid: string) => Promise<WebhookKey>;

const MAX_AGE_SECONDS = 5 * 60;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  body: string;
  header: string | null;
  getKey: KeyFetcher;
  /** Seconds since epoch; test seam. */
  now?: () => number;
}

export async function verifyWebhook(opts: VerifyOptions): Promise<WebhookPayload> {
  if (!opts.header) throw new WebhookVerificationError("missing Plaid-Verification header");
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(opts.header);
  } catch {
    throw new WebhookVerificationError("malformed JWT");
  }
  if (header.alg !== "ES256") throw new WebhookVerificationError(`unexpected alg ${String(header.alg)}`);
  if (!header.kid) throw new WebhookVerificationError("missing kid");

  let key: WebhookKey;
  try {
    key = await opts.getKey(header.kid);
  } catch {
    throw new WebhookVerificationError("unknown kid");
  }
  const now = opts.now?.() ?? Math.floor(Date.now() / 1000);
  if (key.expired_at !== null && key.expired_at <= now) throw new WebhookVerificationError("key expired");

  let payload: Record<string, unknown>;
  try {
    const jwk = await importJWK({ kty: key.kty, crv: key.crv, x: key.x, y: key.y }, "ES256");
    const verified = await jwtVerify(opts.header, jwk, {
      algorithms: ["ES256"],
      maxTokenAge: MAX_AGE_SECONDS,
      currentDate: new Date(now * 1000),
      clockTolerance: 30,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (e) {
    throw new WebhookVerificationError(`signature or age check failed (${(e as Error).name})`);
  }
  if (typeof payload.iat !== "number") throw new WebhookVerificationError("missing iat");

  const claimed = payload.request_body_sha256;
  if (typeof claimed !== "string") throw new WebhookVerificationError("missing body hash");
  if (!constantTimeEqual(claimed, await sha256Hex(opts.body)))
    throw new WebhookVerificationError("body hash mismatch");

  let json: unknown;
  try {
    json = JSON.parse(opts.body);
  } catch {
    throw new WebhookVerificationError("body is not JSON");
  }
  const parsed = WebhookPayload.safeParse(json);
  if (!parsed.success) throw new WebhookVerificationError("payload missing webhook_type/webhook_code");
  return parsed.data;
}

/** Caches verification keys by kid for 24 hours (Plaid rotates rarely). */
export function cachedKeyFetcher(
  client: PlaidClient,
  ttlMs = 24 * 3600 * 1000,
  nowMs: () => number = Date.now,
) {
  const cache = new Map<string, { key: WebhookKey; at: number }>();
  return async (kid: string): Promise<WebhookKey> => {
    const hit = cache.get(kid);
    if (hit && nowMs() - hit.at < ttlMs) return hit.key;
    const { key } = await client.webhookVerificationKeyGet(kid);
    cache.set(kid, { key, at: nowMs() });
    return key;
  };
}

export { sha256Hex };
