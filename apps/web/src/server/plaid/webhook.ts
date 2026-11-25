// Webhook handling (BUILD_PLAN section 5 "Webhooks handled"). Every request is
// verified first; replays are refused by body hash; Item status changes apply
// inline; data refreshes become sync jobs.
import { type Db, findItemByPlaidId, recordSyncEvent, scopeFor, updateItem } from "@fire/db";
import {
  cachedKeyFetcher,
  sha256Hex,
  verifyWebhook,
  type WebhookPayload,
  WebhookVerificationError,
} from "@fire/plaid";
import type { PlaidDeps } from "./config";
import { enqueue, type SyncJob } from "./jobs";

const fetchers = new WeakMap<object, ReturnType<typeof cachedKeyFetcher>>();
function keyFetcher(deps: PlaidDeps) {
  let f = fetchers.get(deps.plaid);
  if (!f) {
    f = cachedKeyFetcher(deps.plaid);
    fetchers.set(deps.plaid, f);
  }
  return f;
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

function jobFor(p: WebhookPayload): SyncJob["parts"] | null {
  const key = `${p.webhook_type}:${p.webhook_code}`;
  switch (key) {
    case "TRANSACTIONS:SYNC_UPDATES_AVAILABLE":
    case "TRANSACTIONS:DEFAULT_UPDATE":
    case "TRANSACTIONS:INITIAL_UPDATE":
    case "TRANSACTIONS:HISTORICAL_UPDATE":
      return ["transactions"];
    case "HOLDINGS:DEFAULT_UPDATE":
    case "INVESTMENTS_TRANSACTIONS:DEFAULT_UPDATE":
      return ["holdings"];
    case "LIABILITIES:DEFAULT_UPDATE":
      return ["accounts", "liabilities"];
    case "ITEM:LOGIN_REPAIRED":
      return ["accounts", "transactions", "liabilities", "holdings"];
    default:
      return null;
  }
}

export async function handleWebhook(
  db: Db,
  deps: PlaidDeps,
  rawBody: string,
  header: string | null,
  now?: () => number,
): Promise<WebhookOutcome> {
  let payload: WebhookPayload;
  try {
    payload = await verifyWebhook({
      body: rawBody,
      header,
      getKey: keyFetcher(deps),
      ...(now ? { now } : {}),
    });
  } catch (e) {
    if (e instanceof WebhookVerificationError) return { status: 401, body: { error: "unverified" } };
    throw e;
  }

  const item = payload.item_id ? await findItemByPlaidId(db, payload.item_id) : null;
  const fresh = await recordSyncEvent(db, {
    householdId: item?.householdId ?? null,
    itemId: item?.id ?? null,
    kind: `webhook:${payload.webhook_type}:${payload.webhook_code}`,
    payloadHash: await sha256Hex(rawBody),
    status: item ? "received" : "unknown-item",
    errorCode: payload.error?.error_code ?? null,
  });
  if (!fresh) return { status: 200, body: { ok: true, replay: true } };
  if (!item) return { status: 200, body: { ok: true, ignored: "unknown item" } };

  const scope = scopeFor(item.householdId);
  const key = `${payload.webhook_type}:${payload.webhook_code}`;
  switch (key) {
    case "ITEM:ERROR":
      if (payload.error?.error_code === "ITEM_LOGIN_REQUIRED") {
        await updateItem(db, scope, item.id, { status: "login_required", errorCode: "ITEM_LOGIN_REQUIRED" });
      } else {
        await updateItem(db, scope, item.id, {
          status: "error",
          errorCode: payload.error?.error_code ?? "ITEM_ERROR",
        });
      }
      return { status: 200, body: { ok: true } };
    case "ITEM:PENDING_EXPIRATION":
    case "ITEM:PENDING_DISCONNECT": {
      const when =
        typeof payload.consent_expiration_time === "string"
          ? new Date(payload.consent_expiration_time)
          : null;
      await updateItem(db, scope, item.id, {
        status: "pending_disconnect",
        errorCode: payload.webhook_code,
        ...(when && !Number.isNaN(when.getTime()) ? { consentExpiresAt: when } : {}),
      });
      return { status: 200, body: { ok: true } };
    }
    case "ITEM:USER_PERMISSION_REVOKED":
    case "ITEM:USER_ACCOUNT_REVOKED":
      await updateItem(db, scope, item.id, { status: "revoked", errorCode: payload.webhook_code });
      return { status: 200, body: { ok: true } };
    case "ITEM:NEW_ACCOUNTS_AVAILABLE":
      await updateItem(db, scope, item.id, { errorCode: "NEW_ACCOUNTS_AVAILABLE" });
      return { status: 200, body: { ok: true } };
    case "ITEM:LOGIN_REPAIRED":
      await updateItem(db, scope, item.id, { status: "healthy", errorCode: null });
      break;
    default:
      break;
  }

  const parts = jobFor(payload);
  if (!parts) return { status: 200, body: { ok: true, ignored: key } };
  const how = await enqueue(db, deps, { householdId: item.householdId, itemId: item.id, parts, reason: key });
  return { status: 200, body: { ok: true, job: how } };
}
