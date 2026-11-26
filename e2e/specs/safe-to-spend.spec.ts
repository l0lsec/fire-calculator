import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";

const dollars = (s: string | null) => Number((s ?? "").replace(/[$,]/g, ""));

test("safe to spend forecasts the connected checking account and follows the cushion", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  expect(ex.status()).toBe(200);

  // Reached as a tab of Spending.
  await page.goto("/spending");
  await page.getByRole("link", { name: "Safe to spend" }).click();
  await expect(page).toHaveURL(/\/safe-to-spend$/);
  await expect(page.getByRole("heading", { name: "Safe to spend", level: 1 })).toBeVisible();

  const amount = page.getByTestId("safe-amount");
  await expect(amount).toHaveText(/^\$[\d,]+(\.\d\d)?$/);
  // The fixture's monthly pay and bills are found and laid out with a running balance.
  const upcoming = page.getByTestId("safe-upcoming").locator("li");
  await expect(upcoming.first()).toBeVisible();
  expect(await upcoming.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("safe-accounts")).toContainText("Spending accounts");

  // No cushion: at least as much as before. A cushion above every balance: nothing is safe.
  const cushion = page.getByTestId("cushion-form");
  const before = dollars(await amount.textContent());
  await cushion.getByLabel("Always keep at least ($)").fill("0");
  await cushion.getByRole("button", { name: "Save cushion" }).click();
  await expect(cushion).toContainText("Cushion set to $0.00");
  await page.reload();
  const loose = dollars(await page.getByTestId("safe-amount").textContent());
  expect(loose).toBeGreaterThanOrEqual(before);

  await page.getByTestId("cushion-form").getByLabel("Always keep at least ($)").fill("1,000,000");
  await page.getByTestId("cushion-form").getByRole("button", { name: "Save cushion" }).click();
  await expect(page.getByTestId("cushion-form")).toContainText("Safe to spend is now $0.00");
  await page.reload();
  await expect(page.getByTestId("safe-amount")).toHaveText("$0");

  // The dashboard carries the same figure.
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-safe")).toContainText("$0");
});
