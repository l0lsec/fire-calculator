// Apply the Drizzle migrations to DATABASE_URL (local stack or production).
import { migrateDatabase } from "../packages/db/src/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await migrateDatabase(url);
console.log("MIGRATIONS_APPLIED");
