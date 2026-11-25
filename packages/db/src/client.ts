// Production client: postgres-js, one connection per request on Workers
// (Hyperdrive pools at the edge; a socket opened for one request cannot be
// reused by another, so module-level pools hang).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Db } from "./db";
import * as schema from "./schema";

export interface Client {
  db: Db;
  close: () => Promise<void>;
}

export function createClient(connectionString: string, opts: { max?: number } = {}): Client {
  const sql = postgres(connectionString, {
    max: opts.max ?? 1,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema }) as unknown as Db;
  return { db, close: () => sql.end({ timeout: 5 }) };
}

export const MIGRATIONS_DIR = new URL("../drizzle", import.meta.url).pathname;

export async function migrateDatabase(connectionString: string, migrationsFolder = MIGRATIONS_DIR) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder, migrationsSchema: "fire_migrations" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
