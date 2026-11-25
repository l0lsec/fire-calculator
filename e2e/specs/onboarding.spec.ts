import { expect, test } from "@playwright/test";
import { totp } from "../helpers/totp";

// node-2: a manual-only household goes from sign-up to a dashboard with dates,
// entirely through the UI (real Supabase auth with TOTP, real forms).
test("a manual-only household goes from sign-up to a dashboard with dates", async ({ page }) => {
  const email = `onboard-${Date.now()}@example.test`;
  const password = `Onboard${Math.random().toString(36).slice(2, 8)}A1`;

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/mfa/);
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.getByLabel("Verification code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Let's set up your plan")).toBeVisible();

  await page.goto("/plan");
  const people = page.locator("section", { has: page.getByRole("heading", { name: "People" }) });
  await people.getByLabel("Name").fill("Sam");
  await people.getByLabel("Birth month").fill("1991-04");
  await people.getByRole("button", { name: "Add person" }).click();
  await expect(people.getByText("born 1991-04")).toBeVisible();

  const spending = page.locator("section", { has: page.getByRole("heading", { name: "Spending today" }) });
  await spending.getByLabel("Annual living spending").fill("48,000");
  await spending.getByLabel("Of which essentials").fill("30,000");
  await spending.getByRole("button", { name: "Save spending" }).click();
  await expect(spending.getByText("Saved.")).toBeVisible();

  const income = page.locator("section", { has: page.getByRole("heading", { name: "Income" }) });
  await income.getByLabel("Name").fill("Salary");
  await income.getByLabel("Monthly amount (after tax)").fill("6,500");
  await income.getByRole("button", { name: "Add income" }).click();
  await expect(income.getByText("Salary")).toBeVisible();

  await page.goto("/accounts");
  await page.getByLabel("Name").last().fill("Index funds");
  await page.getByLabel("Type").last().selectOption("taxable");
  await page.getByLabel("Balance").last().fill("60,000");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Index funds")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByTestId("fi-target")).toBeVisible();
  await expect(page.getByTestId("fi-when")).toHaveText(/^[A-Z][a-z]{2} \d{4}$/);
  await expect(page.getByTestId("ladder-coast-when")).toBeVisible();
});
