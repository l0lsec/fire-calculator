import {
  findHouseholdIdForUser,
  getItem,
  listItems,
  listSyncEvents,
  listTransactions,
  scopeFor,
} from "@fire/db";
import { loadKeyring, open, tokenAad } from "@fire/db/crypto";
import { PlaidClient } from "@fire/plaid";
import { expect, type Page, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { ENV } from "../helpers/env";
import { db } from "../helpers/seed";

const plaid = new PlaidClient({
  clientId: ENV.PLAID_CLIENT_ID as string,
  secret: ENV.PLAID_SECRET as string,
  env: "sandbox",
});
const webhook = `${process.env.E2E_TUNNEL_URL}/api/plaid/webhook`;

async function linkedUser(page: Page, context: Parameters<typeof signInContext>[0], baseURL: string) {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL);
  await page.goto("/dashboard");
  const pub = await plaid.sandboxPublicTokenCreate("ins_109508", { webhook });
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: pub.public_token, institution: { id: "ins_109508", name: "First Platypus Bank" } },
  });
  expect(ex.status()).toBe(200);
  const { db: d, close } = db();
  try {
    const scope = scopeFor((await findHouseholdIdForUser(d, user.userId)) as string);
    const [item] = await listItems(d, scope);
    const ring = await loadKeyring(ENV.TOKEN_ENCRYPTION_KEYS);
    const token = await open(
      ring,
      { ciphertext: item!.accessTokenCiphertext, iv: item!.accessTokenIv, keyVersion: item!.keyVersion },
      tokenAad(scope.householdId, item!.plaidItemId),
    );
    return { scope, item: item!, token };
  } finally {
    await close();
  }
}

test("a fired SYNC_UPDATES_AVAILABLE from the real Sandbox is verified and processed", async ({
  page,
  context,
  baseURL,
}) => {
  const { scope, item, token } = await linkedUser(page, context, baseURL as string);
  const unsigned = await page.request.post("/api/plaid/webhook", {
    data: { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: item.plaidItemId },
  });
  expect(unsigned.status()).toBe(401);

  await plaid.sandboxFireWebhook(token, "SYNC_UPDATES_AVAILABLE");
  await expect
    .poll(
      async () => {
        const { db: d, close } = db();
        try {
          const events = await listSyncEvents(d, scope, 200);
          const got = events.some(
            (e) => e.itemId === item.id && e.kind === "webhook:TRANSACTIONS:SYNC_UPDATES_AVAILABLE",
          );
          const rows = await listTransactions(d, scope, "2000-01-01", "2100-01-01");
          return got && rows.length > 0;
        } finally {
          await close();
        }
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);
});

test("update mode through Plaid Link restores a reset Item to Connected", async ({
  page,
  context,
  baseURL,
}) => {
  const { scope, item, token } = await linkedUser(page, context, baseURL as string);
  await plaid.sandboxResetLogin(token);
  await page.goto("/connections");
  await page.getByRole("button", { name: "Refresh now" }).click();
  await page.reload();
  await expect(page.getByTestId("item-status")).toHaveText("Sign-in needed");

  await page.getByRole("button", { name: "Reconnect" }).click();
  const link = page.frameLocator("iframe[id^='plaid-link-iframe']");
  // Sandbox update mode: continue through consent, sign in as user_good, finish.
  for (let step = 0; step < 12; step++) {
    if ((await page.locator("iframe[id^='plaid-link-iframe']").count()) === 0) break;
    const user = link.locator("input[name='username'], input[id*='username']");
    if (await user.count()) {
      await user.first().fill("user_good");
      await link.locator("input[type='password']").first().fill("pass_good");
    }
    const next = link.getByRole("button", { name: /continue|submit|connect|done|allow|sign in/i }).first();
    if (await next.count()) await next.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (await page.getByText("Reconnected.").count()) break;
  }
  await expect(page.getByText("Reconnected.")).toBeVisible({ timeout: 60_000 });
  const { db: d, close } = db();
  try {
    expect((await getItem(d, scope, item.id))?.status).toBe("healthy");
  } finally {
    await close();
  }
});
