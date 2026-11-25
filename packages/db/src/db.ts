import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTable } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

declare const scopeBrand: unique symbol;

/**
 * Proof that the caller is acting for one household. Repository functions take
 * nothing else to decide whose rows they touch. Only the auth layer (for a
 * verified MFA session) and the Plaid system jobs (for an Item they looked up)
 * create scopes; a repository guard enforces that.
 */
export interface HouseholdScope {
  readonly householdId: string;
  readonly [scopeBrand]: true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scopeFor(householdId: string): HouseholdScope {
  if (!UUID.test(householdId)) throw new Error("scopeFor: household id must be a uuid");
  return Object.freeze({ householdId }) as HouseholdScope;
}

export class NotOwnedError extends Error {
  constructor(what: string) {
    super(`${what} does not belong to this household`);
    this.name = "NotOwnedError";
  }
}

type OwnedTable = PgTable & {
  id: import("drizzle-orm/pg-core").PgColumn;
  householdId: import("drizzle-orm/pg-core").PgColumn;
};

/** Throw unless `id` is a row of `table` in this household. */
export async function assertOwned(
  db: Db,
  scope: HouseholdScope,
  table: OwnedTable,
  id: string,
  what: string,
) {
  if (!UUID.test(id)) throw new NotOwnedError(what);
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.householdId, scope.householdId)))
    .limit(1);
  if (rows.length === 0) throw new NotOwnedError(what);
}

export function isUuid(id: string): boolean {
  return UUID.test(id);
}
