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
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("No banks connected.")).toBeVisible();
});
