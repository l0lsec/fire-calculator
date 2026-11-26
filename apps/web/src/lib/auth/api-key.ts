import "server-only";
// Personal access keys for AI assistants. A key is "fire_" plus 32 random
// bytes (base64url); only its SHA-256 is stored. The MCP endpoint and the REST
// API take it as "Authorization: Bearer <key>" and get the same household
// scope a signed-in page would, narrowed to the key's access level.
import { type ApiAccess, findLiveApiToken, scopeFor, touchApiToken } from "@fire/db";
import { getDb } from "../db";
import { allow } from "../security/rate-limit";
import type { AppContext } from "./context";

export const KEY_PREFIX = "fire_";
const KEY_RE = /^fire_[A-Za-z0-9_-]{43}$/;

export interface ApiKeyContext extends AppContext {
  tokenId: string;
  access: ApiAccess;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashApiKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new secret, its hash for storage, and the short prefix shown in the key list. */
export async function newApiKey(): Promise<{ secret: string; hash: string; prefix: string }> {
  const secret = KEY_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { secret, hash: await hashApiKey(secret), prefix: secret.slice(0, 11) };
}

export function bearerKey(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1] && KEY_RE.test(m[1]) ? m[1] : null;
}

function unauthorized(message: string, status = 401): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "WWW-Authenticate": 'Bearer realm="fire-planner"',
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Route-handler auth for the AI endpoints. Returns the household context for a
 * live key, or a 401/429 Response. `client` is recorded as the key's last user.
 */
export async function requireApiKeyContext(
  request: Request,
  opts: { client?: string | null } = {},
): Promise<ApiKeyContext | Response> {
  const secret = bearerKey(request);
  if (!secret) return unauthorized("Send an AI access key as: Authorization: Bearer fire_...");
  const db = getDb();
  const grant = await findLiveApiToken(db, await hashApiKey(secret));
  if (!grant) return unauthorized("This key was revoked, has expired, or does not exist.");
  if (!(await allow(`ai-key:${grant.id}`, 120)))
    return Response.json(
      { error: "Too many requests for this key. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  await touchApiToken(db, grant.id, opts.client ?? null).catch(() => undefined);
  return {
    userId: grant.userId,
    email: null,
    scope: scopeFor(grant.householdId),
    db,
    tokenId: grant.id,
    access: grant.access,
  };
}
