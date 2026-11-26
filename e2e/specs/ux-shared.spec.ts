// The shared UI pieces behave as docs/UX_PRINCIPLES.md promises: forms keep
// what you typed when a save fails, buttons are full size and say what they
// are doing, destructive actions confirm in a real dialog, and reversible
// changes offer Undo that really reverses them.
import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { seedWorkedExample } from "../helpers/seed";

const dollars = (s: string | null) => Number((s ?? "").replace(/[$,]/g, ""));

test("a failed save keeps every typed value, and a good save still clears an add form", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/plan");
  const income = page.locator("section", { has: page.getByRole("heading", { name: "Income" }) });
  await income.getByLabel("Name").fill("Side gig");
  await income.getByLabel("Monthly amount (after tax)").fill("twelve hundred");
  await income.getByLabel("Starts at age (optional)").fill("40");
  await income.getByRole("button", { name: "Add income" }).click();
  await expect(income.getByText("Enter a dollar amount like 1,250.00")).toBeVisible();
  await expect(income.getByLabel("Name")).toHaveValue("Side gig");
  await expect(income.getByLabel("Monthly amount (after tax)")).toHaveValue("twelve hundred");
  await expect(income.getByLabel("Starts at age (optional)")).toHaveValue("40");
  // The first invalid field has focus so the fix is one keystroke away.
  await expect(income.getByLabel("Monthly amount (after tax)")).toBeFocused();

  await income.getByLabel("Monthly amount (after tax)").fill("1,200");
  await income.getByRole("button", { name: "Add income" }).click();
  await expect(income.locator("li", { hasText: "Side gig" })).toBeVisible();
  await expect(income.getByLabel("Name")).toHaveValue("");
});

test("row buttons are full size, show progress, and confirm destructive actions in a dialog", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  const del = page.getByRole("button", { name: /^Delete/ }).first();
  const box = await del.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);

  const before = await page.getByRole("button", { name: /^Delete/ }).count();
  await del.click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  // Destructive: focus starts on Cancel, so Enter alone never deletes.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(before);

  await page
    .getByRole("button", { name: /^Delete/ })
    .first()
    .click();
  // Slow the server down: the button must say it is working well inside 400 ms.
  await page.route("**/debts", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  const busy = page.getByRole("button", { name: /^Delete/ }).first();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(busy).toHaveAttribute("aria-busy", "true", { timeout: 400 });
  await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(before - 1);
  // Done is announced in the polite status region.
  await expect(page.getByRole("region", { name: "Notifications" }).getByTestId("toast")).toContainText(
    "Deleted.",
  );
});

test("undo on a spending decision puts the item back and restores the total", async ({
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
  const total = async () => dollars(await page.getByTestId("spending-total").textContent());
  const before = await total();
  const rows = () => page.getByTestId("review-queue").locator("li", { hasText: "HOME FURNISHINGS CO" });
  await rows().getByRole("button", { name: "One-time" }).click();
  await expect(rows()).toHaveCount(0);
  await expect.poll(total).toBe(before - 4200);
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("one-time");
  await toast.getByTestId("toast-undo").click();
  await expect(rows()).toHaveCount(1);
  await expect.poll(total).toBe(before);
});

test("a hard delete offers no undo", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  await page
    .getByRole("button", { name: /^Delete/ })
    .first()
    .click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("toast-undo")).toHaveCount(0);
});

test("the main nav marks the current place and shows its tabs", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/budgets");
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link")).toHaveCount(7);
  await expect(main.getByRole("link", { name: "Spending" })).toHaveAttribute("aria-current", "page");
  const tabs = page.getByRole("navigation", { name: "Spending sections" });
  await expect(tabs.getByRole("link", { name: "Budgets" })).toHaveAttribute("aria-current", "page");
  await page.goto("/connections");
  await expect(main.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dashboard");
  const menu = page.getByRole("button", { name: /Dashboard/ });
  await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Debts" }).click();
  await expect(page).toHaveURL(/\/debts$/);
});
