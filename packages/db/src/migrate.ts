// Migration helpers for scripts and tests (never imported by the web app, whose
// bundler would otherwise try to package the migrations folder).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const MIGRATIONS_DIR = new URL("../drizzle", import.meta.url).pathname;

export async function migrateDatabase(connectionString: string, migrationsFolder = MIGRATIONS_DIR) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder, migrationsSchema: "fire_migrations" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
