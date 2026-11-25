// Real Plaid Sandbox. Runs only when sandbox keys are in .env; the gates that
// name the Sandbox require these tests to PASS (a skip fails the gate).
import { readFileSync } from "node:fs";
import { createHouseholdForUser, getItem, scopeFor } from "@fire/db";
import { generateKeySpec, loadKeyring, open, tokenAad } from "@fire/db/crypto";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { PlaidClient } from "@fire/plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlaidDeps } from "../src/server/plaid/config";
import { exchangePublicToken } from "../src/server/plaid/link";
import { syncItem } from "../src/server/plaid/sync";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const haveKeys =
  Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET) && (env.PLAID_ENV ?? "sandbox") === "sandbox";

let t: TestDb;
let deps: PlaidDeps;

describe.skipIf(!haveKeys)("real Plaid Sandbox", () => {
  beforeAll(async () => {
    t = await createTestDb();
    deps = {
      plaid: new PlaidClient({
        clientId: env.PLAID_CLIENT_ID as string,
        secret: env.PLAID_SECRET as string,
        env: "sandbox",
      }),
      ring: await loadKeyring(generateKeySpec(1)),
      webhookUrl: null,
    };
  });
  afterAll(async () => t?.close());

  async function link() {
    const ctx = {
      db: t.db,
      scope: scopeFor(await createHouseholdForUser(t.db, crypto.randomUUID(), "Sandbox")),
    };
    const pub = await deps.plaid.sandboxPublicTokenCreate("ins_109508");
    const r = await exchangePublicToken(ctx, deps, pub.public_token, {
      id: "ins_109508",
      name: "First Platypus Bank",
    });
    return { ctx, r, item: (await getItem(ctx.db, ctx.scope, r.itemId))! };
  }

  it("a Sandbox Link completes and the stored token decrypts", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      }),
    );
    let linked: Awaited<ReturnType<typeof link>>;
    try {
      linked = await link();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const { ctx, r, item } = linked;
    const token = await open(
      deps.ring,
      { ciphertext: item.accessTokenCiphertext, iv: item.accessTokenIv, keyVersion: item.keyVersion },
      tokenAad(ctx.scope.householdId, item.plaidItemId),
    );
    expect(token).toMatch(/^access-sandbox-/);
    expect(r.accounts).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
  }, 120_000);

  it("Sandbox reset_login flips the Item to login_required", async () => {
    const { ctx, item } = await link();
    const token = await open(
      deps.ring,
      { ciphertext: item.accessTokenCiphertext, iv: item.accessTokenIv, keyVersion: item.keyVersion },
      tokenAad(ctx.scope.householdId, item.plaidItemId),
    );
    await deps.plaid.sandboxResetLogin(token);
    const r = await syncItem(ctx, deps, item.id, ["accounts"]);
    expect(r.status).toBe("login_required");
    expect((await getItem(ctx.db, ctx.scope, item.id))?.status).toBe("login_required");
  }, 120_000);
});
