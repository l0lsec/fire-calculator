// Runs against the local Supabase Postgres (pnpm db:up): PGlite has a single
// connection and cannot reproduce races.
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createHouseholdForUser, findHouseholdIdForUser } from "../src";
import { createClient } from "../src/client";

const envFile = new URL("../../../.env", import.meta.url);
const url =
  process.env.DATABASE_URL ??
  (existsSync(envFile)
    ? readFileSync(envFile, "utf8")
        .split("\n")
        .find((l) => l.startsWith("DATABASE_URL="))
        ?.slice("DATABASE_URL=".length)
    : undefined);

const client = createClient(url ?? "postgres://invalid", { max: 10 });
afterAll(() => client.close());

// Skipped where no local stack exists (CI); its gate requires it to pass.
describe.skipIf(!url)("concurrency", () => {
  it("concurrent first visits create exactly one household per user", async () => {
    expect(url, "DATABASE_URL must point at the local stack").toBeTruthy();
    const userId = crypto.randomUUID();
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => createHouseholdForUser(client.db, userId, "Race")),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await findHouseholdIdForUser(client.db, userId)).toBe(ids[0]);
  });
});
