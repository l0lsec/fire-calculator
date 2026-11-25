// Resets the local Supabase database (auth users included) and re-applies migrations.
import { assert, run } from "./lib.mjs";

export function cleanDatabase() {
  run("supabase", ["db", "reset", "--local"]);
  const m = run("pnpm", ["-s", "db:migrate"]);
  assert(m.out.includes("MIGRATIONS_APPLIED"), "migrations did not apply after reset");
}
