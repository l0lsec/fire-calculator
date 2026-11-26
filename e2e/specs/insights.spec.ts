import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";

test("budgets, bills and alerts work against a connected bank", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard"); // creates the household
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  expect(ex.status()).toBe(200);

  // Bills and subscriptions renders its totals from the fixture's transactions.
  await page.goto("/bills");
  await expect(page.getByRole("heading", { name: "Bills and subscriptions" })).toBeVisible();
  await expect(page.getByTestId("subs-monthly")).toContainText("/mo");

  // A budget typed inline is saved and survives a reload.
  await page.goto("/budgets");
  const firstInput = page.getByRole("textbox", { name: /Monthly budget for/ }).first();
  await expect(firstInput).toBeVisible();
  const label = await firstInput.getAttribute("aria-label").catch(() => null);
  await firstInput.fill("150");
  await firstInput.press("Enter");
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("budget-total")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Monthly budget for/ }).first()).toHaveValue("150");
  expect(label === null || label.length > 0).toBe(true);

  // Raising the low-balance level makes the checking account alert; dismissing it sticks.
  await page.goto("/alerts");
  await page.getByLabel("Low balance under").fill("1,000,000");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  const low = page.getByTestId("alert").filter({ hasText: "Low balance" }).first();
  await expect(low).toBeVisible();
  const title = (await low.locator("p.font-medium").textContent())?.trim() ?? "";
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-alerts")).toBeVisible();
  await page.goto("/alerts");
  await page.getByTestId("alert").filter({ hasText: title }).getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("alert").filter({ hasText: title })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("alert").filter({ hasText: title })).toHaveCount(0);

  // A bad threshold is refused with a field error.
  await page.getByLabel("Remind me of bills (days ahead)").fill("90");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("0 to 30 days")).toBeVisible();
});
