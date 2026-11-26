// Personal access keys for AI assistants (MCP and the REST API). The secret
// itself never reaches this layer: callers pass its SHA-256.
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db, HouseholdScope } from "../db";
import { apiTokens, householdMembers } from "../schema";

export type ApiAccess = "read" | "write";

/** What the UI may see about a key: never the hash. */
export interface ApiTokenInfo {
  id: string;
  name: string;
  access: ApiAccess;
  prefix: string;
  lastUsedAt: Date | null;
  lastClient: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

const info = {
  id: apiTokens.id,
  name: apiTokens.name,
  access: apiTokens.access,
  prefix: apiTokens.prefix,
  lastUsedAt: apiTokens.lastUsedAt,
  lastClient: apiTokens.lastClient,
  expiresAt: apiTokens.expiresAt,
  createdAt: apiTokens.createdAt,
};

const asInfo = (r: { access: string } & Omit<ApiTokenInfo, "access">): ApiTokenInfo => ({
  ...r,
  access: r.access === "write" ? "write" : "read",
});

export async function createApiToken(
  db: Db,
  scope: HouseholdScope,
  v: {
    userId: string;
    name: string;
    access: ApiAccess;
    tokenHash: string;
    prefix: string;
    expiresAt: Date | null;
  },
): Promise<ApiTokenInfo> {
  const [row] = await db
    .insert(apiTokens)
    .values({ ...v, householdId: scope.householdId })
    .returning(info);
  return asInfo(row!);
}

/** Keys that still work or could (not revoked), newest first. */
export async function listApiTokens(db: Db, scope: HouseholdScope): Promise<ApiTokenInfo[]> {
  const rows = await db
    .select(info)
    .from(apiTokens)
    .where(and(eq(apiTokens.householdId, scope.householdId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(asInfo);
}

export async function revokeApiToken(
  db: Db,
  scope: HouseholdScope,
  id: string,
): Promise<ApiTokenInfo | null> {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiTokens.id, id), eq(apiTokens.householdId, scope.householdId), isNull(apiTokens.revokedAt)),
    )
    .returning(info);
  return row ? asInfo(row) : null;
}

/** Undo a revoke made moments ago (the UI's Undo). Only a key revoked in the last 10 minutes comes back. */
export async function restoreApiToken(db: Db, scope: HouseholdScope, id: string): Promise<boolean> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: null })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.householdId, scope.householdId),
        sql`${apiTokens.revokedAt} > now() - interval '10 minutes'`,
      ),
    )
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

export interface ApiTokenGrant {
  id: string;
  householdId: string;
  userId: string;
  access: ApiAccess;
}

/**
 * The key with this hash, if it is live: not revoked, not expired, and its
 * creator still belongs to the household it was made for. This is a lookup by
 * secret, like a session lookup, so it takes no scope; the auth layer turns
 * the result into one.
 */
export async function findLiveApiToken(
  db: Db,
  tokenHash: string,
  now = new Date(),
): Promise<ApiTokenGrant | null> {
  const rows = await db
    .select({
      id: apiTokens.id,
      householdId: apiTokens.householdId,
      userId: apiTokens.userId,
      access: apiTokens.access,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .innerJoin(
      householdMembers,
      and(
        eq(householdMembers.userId, apiTokens.userId),
        eq(householdMembers.householdId, apiTokens.householdId),
      ),
    )
    .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
    .limit(1);
  const r = rows[0];
  if (!r || (r.expiresAt && r.expiresAt <= now)) return null;
  return {
    id: r.id,
    householdId: r.householdId,
    userId: r.userId,
    access: r.access === "write" ? "write" : "read",
  };
}

/** Record use, at most once a minute per key so every call is not a write. */
export async function touchApiToken(db: Db, id: string, client?: string | null): Promise<void> {
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date(), ...(client ? { lastClient: client.slice(0, 80) } : {}) })
    .where(
      and(
        eq(apiTokens.id, id),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`)),
      ),
    );
}
