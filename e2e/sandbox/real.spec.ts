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
const tunnel = process.env.E2E_TUNNEL_URL ?? "";
const webhook = tunnel ? `${tunnel}/api/plaid/webhook` : "";

async function linkedUser(page: Page, context: Parameters<typeof signInContext>[0], baseURL: string) {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL);
  await page.goto("/dashboard");
  const pub = await plaid.sandboxPublicTokenCreate("ins_109508", webhook ? { webhook } : {});
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
  test.skip(!tunnel, "needs a public tunnel (FIRE_ALLOW_TUNNEL=1)");
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
  // The server action revalidates the page when the sync finishes.
  await expect(page.getByTestId("item-status")).toHaveText("Sign-in needed", { timeout: 90_000 });

  await page.getByRole("button", { name: "Reconnect" }).click();
  const frameSel = "iframe[src*='plaid.com']";
  await page.locator(frameSel).first().waitFor({ state: "attached", timeout: 30_000 });
  const link = page.frameLocator(frameSel).first();

  // 1. Plaid's optional phone screen.
  const skipPhone = link.getByRole("button", { name: /continue without phone/i });
  await skipPhone.waitFor({ timeout: 30_000 }).catch(() => {});
  if (await skipPhone.count()) await skipPhone.first().click();

  // 2. The Sandbox bank's login, once.
  const loginHeading = link.getByText(/log into/i).first();
  await loginHeading.waitFor({ timeout: 30_000 });
  await link
    .getByLabel(/^username$/i)
    .first()
    .fill("user_good");
  await link
    .getByLabel(/^password$/i)
    .first()
    .fill("pass_good");
  await link
    .getByRole("button", { name: /^submit$/i })
    .first()
    .click();
  await loginHeading.waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});

  // 3. Click through any confirmation screens until Link closes.
  for (let step = 0; step < 75; step++) {
    if (
      (await page.locator(frameSel).count()) === 0 ||
      (await page
        .getByTestId("item-status")
        .innerText()
        .catch(() => "")) === "Connected"
    )
      break;
    if (process.env.DEBUG_LINK) {
      const texts = await link
        .locator("button")
        .allInnerTexts()
        .catch(() => [] as string[]);
      const body = (
        (await link
          .locator("body")
          .innerText()
          .catch(() => "")) || ""
      )
        .replace(/\s+/g, " ")
        .slice(0, 160);
      console.log(`LINK ${step}: ${JSON.stringify(texts)} ${body}`);
    }
    // Never opt into Plaid's "save with Plaid" account; finish without saving.
    const finish = link.getByRole("button", { name: /finish without saving/i });
    const next = (await finish.count())
      ? finish.first()
      : link.getByRole("button", { name: /^(continue|done|allow|connect|finish)$/i }).first();
    if (await next.count()) await next.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  // The refreshed page drops the reconnect panel (and its message) once the Item is healthy.
  await expect(page.getByTestId("item-status")).toHaveText("Connected", { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  const { db: d, close } = db();
  try {
    expect((await getItem(d, scope, item.id))?.status).toBe("healthy");
  } finally {
    await close();
  }
});
