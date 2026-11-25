// In-process Postgres (PGlite) with migrations applied, for tests.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_DIR } from "./client";
import type { Db } from "./db";
import * as schema from "./schema";

export interface TestDb {
  db: Db;
  pg: PGlite;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const d = drizzle(pg, { schema });
  const run = () => migrate(d, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: "fire_migrations" });
  await run();
  return { db: d as unknown as Db, pg, migrate: run, close: () => pg.close() };
}
