#!/usr/bin/env node
// Back up the local database (app schema plus auth users) to backups/ (git-ignored):
// `pnpm backup`. Restore with: docker exec -i supabase_db_fire-calculator psql -U postgres < <file>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync("backups", { recursive: true, mode: 0o700 });
const out = execFileSync(
  "docker",
  [
    "exec",
    "supabase_db_fire-calculator",
    "pg_dump",
    "-U",
    "postgres",
    "--clean",
    "--if-exists",
    "-n",
    "fire",
    "-n",
    "fire_migrations",
    "-t",
    "auth.users",
    "-t",
    "auth.identities",
    "-t",
    "auth.mfa_factors",
  ],
  { maxBuffer: 1024 * 1024 * 1024 },
);
const file = `backups/fire-${stamp}.sql`;
writeFileSync(file, out, { mode: 0o600 });
console.log(`BACKUP_WRITTEN ${file} (${out.length} bytes)`);
