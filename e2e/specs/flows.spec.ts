import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { seedWorkedExample } from "../helpers/seed";

const dollars = (s: string | null) => Number((s ?? "").replace(/[$,]/g, ""));

test("review spending: marking a large purchase one-time lowers the annual total", async ({
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
  const before = dollars(await page.getByTestId("spending-total").textContent());
  const row = page.getByTestId("review-queue").locator("li", { hasText: "HOME FURNISHINGS CO" });
  await row.getByRole("button", { name: "One-time" }).click();
  await expect(
    page.getByTestId("review-queue").locator("li", { hasText: "HOME FURNISHINGS CO" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => dollars(await page.getByTestId("spending-total").textContent()))
    .toBe(before - 4200);
});

test("business accounts: spending stays in the total and is shown apart", async ({
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
  const total = await page.getByTestId("spending-total").textContent();
  await expect(page.getByTestId("spending-business")).toHaveCount(0);
  const first = page.getByTestId("spending-accounts").locator("li").first();
  await first.getByRole("button", { name: "Mark as business" }).click();
  await expect(page.getByTestId("spending-business")).toContainText("business $");
  await expect(page.getByTestId("spending-total")).toHaveText(total ?? "");
  await page.reload();
  await expect(page.getByTestId("spending-business")).toBeVisible();
  await page
    .getByTestId("spending-accounts")
    .locator("li", { hasText: "business" })
    .getByRole("button", { name: "Mark as personal" })
    .click();
  await expect(page.getByTestId("spending-business")).toHaveCount(0);
});

test("setup takes take-home pay and savings from connected accounts", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/setup?step=people");
  await page.getByLabel("Name").fill("Sam");
  await page.getByLabel("Birth month").fill(`${new Date().getFullYear() - 34}-04`);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByTestId("progress-count")).toHaveText("1 of 4 done");
  await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  await page.goto("/setup?step=income");
  // Spending, income and savings all come from the connected bank.
  await expect(page.getByTestId("progress-count")).toHaveText("4 of 4 done");
  const measured = page.getByTestId("setup-income-measured");
  await expect(measured).toContainText("a month");
  await expect(measured).toContainText("Your plan uses this");
  // Manual income is tucked away for what the accounts cannot show.
  await expect(page.getByRole("button", { name: "Add income" })).toBeHidden();
  await page.goto("/setup?step=savings");
  await expect(page.getByTestId("setup-savings-synced").locator("li").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add account" })).toBeHidden();
});

test("change debt strategy: the planner's choice is saved to the plan", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  await page.getByTestId("strategy-select").selectOption("snowball");
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByText("Saved to your plan.")).toBeVisible();
  await page.goto("/plan");
  await expect(page.getByLabel("Payoff strategy")).toHaveValue("snowball");
  await page.goto("/debts");
  await expect(page.getByTestId("strategy-select")).toHaveValue("snowball");
});

test("disconnect a bank through the UI", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: {
      public_token: await fakePlaid.publicToken(),
      institution: { id: "ins_fixture", name: "Fixture Bank" },
    },
  });
  await page.goto("/connections");
  await expect(page.getByTestId("item-status")).toHaveText("Connected");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText("No banks connected.")).toBeVisible();
});
