import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { db } from "../helpers/seed";

async function itemFor(userId: string) {
  const { db: d, close } = db();
  try {
    const { findHouseholdIdForUser, listItems, scopeFor } = await import("@fire/db");
    const hh = await findHouseholdIdForUser(d, userId);
    if (!hh) throw new Error("no household");
    const [item] = await listItems(d, scopeFor(hh));
    if (!item) throw new Error("no item");
    return { householdId: hh, item };
  } finally {
    await close();
  }
}

test("connect, sync and a verified webhook work end to end over HTTP", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard"); // creates the household

  const token = await page.request.post("/api/plaid/link/token", { data: {} });
  expect(token.status()).toBe(200);
  expect((await token.json()).link_token).toMatch(/^link-sandbox-fake-/);

  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: {
      public_token: await fakePlaid.publicToken(),
      institution: { id: "ins_fixture", name: "Fixture Bank" },
    },
  });
  expect(ex.status()).toBe(200);
  const body = await ex.json();
  expect(body.accounts).toBe(8);
  expect(JSON.stringify(body)).not.toMatch(/access-sandbox/);

  await page.goto("/accounts");
  await expect(page.getByText("Everyday Checking")).toBeVisible();

  // Unsigned webhook: refused.
  const unsigned = await page.request.post("/api/plaid/webhook", {
    data: { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "x" },
  });
  expect(unsigned.status()).toBe(401);

  // New activity at the bank, then a signed SYNC_UPDATES_AVAILABLE.
  const { item } = await itemFor(user.userId);
  await fakePlaid.addTransactions(item.plaidItemId, [
    {
      transaction_id: "tx_e2e_webhook",
      account_id: "acc_chk",
      amount: 77.7,
      iso_currency_code: "USD",
      date: "2026-11-21",
      authorized_date: null,
      name: "WEBHOOK SHOP",
      merchant_name: "Webhook Shop",
      pending: false,
      personal_finance_category: {
        primary: "GENERAL_MERCHANDISE",
        detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      },
    },
  ]);
  await fakePlaid.fireWebhook(item.plaidItemId, "TRANSACTIONS", "SYNC_UPDATES_AVAILABLE");
  await expect
    .poll(async () => {
      const { db: d, close } = db();
      try {
        const { listTransactions, scopeFor } = await import("@fire/db");
        const rows = await listTransactions(d, scopeFor(item.householdId), "2026-11-21", "2026-11-21");
        return rows.some((r) => r.name === "WEBHOOK SHOP");
      } finally {
        await close();
      }
    })
    .toBe(true);
});

test("a login error shows Reconnect, and a repaired login clears it", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  const { item } = await itemFor(user.userId);

  await fakePlaid.setError(item.plaidItemId, "ITEM_LOGIN_REQUIRED");
  await fakePlaid.fireWebhook(item.plaidItemId, "ITEM", "ERROR", {
    error: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" },
  });
  await page.goto("/connections");
  await expect(page.getByTestId("item-status")).toHaveText("Sign-in needed");
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();

  await fakePlaid.setError(item.plaidItemId, null);
  await fakePlaid.fireWebhook(item.plaidItemId, "ITEM", "LOGIN_REPAIRED");
  await page.reload();
  await expect(page.getByTestId("item-status")).toHaveText("Connected");
});

test("delete my data revokes the connection, purges the household and signs out", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  const { householdId } = await itemFor(user.userId);

  await page.goto("/connections");
  await page.getByLabel('Type "DELETE" to confirm').fill("DELETE");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  const { db: d, close } = db();
  try {
    const { countHouseholdRows, scopeFor } = await import("@fire/db");
    const counts = await countHouseholdRows(d, scopeFor(householdId));
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  } finally {
    await close();
  }
});

test("measured spending from the connected bank matches the golden total", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  await page.goto("/spending");
  // The fixture's living spending (T3.2 golden) plus escrow from the mortgage record.
  const total = await page.getByTestId("spending-total").textContent();
  const dollars = Number((total ?? "").replace(/[$,]/g, ""));
  const { db: d, close } = db();
  let escrowAnnual = 0;
  try {
    const { findHouseholdIdForUser, listDebts, scopeFor } = await import("@fire/db");
    const hh = (await findHouseholdIdForUser(d, user.userId))!;
    escrowAnnual =
      (await listDebts(d, scopeFor(hh))).reduce((s, x) => s + x.escrowMonthlyCents * 12, 0) / 100;
  } finally {
    await close();
  }
  expect(escrowAnnual).toBeGreaterThan(6000);
  expect(dollars).toBe(Math.round(25_960 + escrowAnnual));
  await page.getByRole("button", { name: "Use as my retirement baseline" }).click();
  await expect(page.getByText("Your plan uses this measured spending.")).toBeVisible();
});
