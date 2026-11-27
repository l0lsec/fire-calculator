// Every figure built from transactions opens the charges it is made of
// (docs/UX_PRINCIPLES.md, law 19): Bills, Budgets, Spending and Safe to spend.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";

const cents = async (l: Locator) =>
  Math.round(Number((await l.textContent())?.replace(/[^0-9.-]/g, "")) * 100);

/** Open a charge list and check its rows add up to its total line. */
async function openAndSum(list: Locator): Promise<number> {
  await list.getByRole("button").first().click();
  const rows = list.getByTestId("charge-row");
  await expect(rows.first()).toBeVisible();
  // Long lists show 25 rows until "Show all".
  const all = list.getByRole("button", { name: /^Show all/ });
  if (await all.count()) await all.click();
  let sum = 0;
  for (const r of await rows.all()) sum += await cents(r.locator("span.num").last());
  const total = await cents(list.locator('[data-testid$="-total"] span.num'));
  expect(sum).toBe(total);
  return total;
}

async function connect(page: Page) {
  await page.goto("/dashboard");
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  expect(ex.status()).toBe(200);
}

test("bills, budgets, spending and safe to spend open the real charges behind each figure", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await connect(page);

  // Bills: the tile opens each series, and each series opens its charges.
  await page.goto("/bills");
  const firstRow = page.getByTestId("recurring-row").first();
  await expect(firstRow).toBeVisible();
  await openAndSum(firstRow.getByTestId("series-charges"));
  await expect(firstRow.getByTestId("series-charges")).toContainText("Per month:");
  for (const id of ["subscriptions", "bills"]) {
    const tile = page.getByTestId(`tile-${id}`);
    if (!(await tile.isVisible())) continue;
    await tile.click();
    const panel = page.getByTestId(`breakdown-${id}`);
    await expect(panel).toBeVisible();
    const lineCharges = panel.getByRole("button", { name: /^See the \d+ charges$/ });
    if (await lineCharges.count()) {
      await lineCharges.first().click();
      await expect(panel.getByTestId("charge-row").first()).toBeVisible();
    }
  }

  // Budgets: a category's spending this month is exactly its charges.
  await page.goto("/budgets");
  const budget = page.locator('li[data-testid^="budget-"]').first();
  await expect(budget).toBeVisible();
  const spent = await cents(budget.locator("div").first().locator("span.text-sm").first());
  const listed = await openAndSum(budget.getByTestId("budget-month-charges"));
  expect(Math.abs(listed - spent)).toBeLessThan(100); // the row shows whole dollars
  await budget.getByTestId("budget-typical-charges").getByRole("button").first().click();
  await expect(budget.getByTestId("budget-typical-charges")).toContainText("Typical month");

  // Spending: a category's yearly figure is its charges (a full year of fixture history).
  await page.goto("/spending");
  const cat = page.getByTestId("category-row").first();
  const yearly = await cents(cat.locator("span.num").first());
  const catListed = await openAndSum(cat.getByTestId("category-charges"));
  expect(Math.abs(catListed - yearly)).toBeLessThan(100);

  // Safe to spend: the headline opens its steps, and a predicted item opens its past charges.
  await page.goto("/safe-to-spend");
  await page.getByTestId("safe-drill").click();
  const safe = page.getByTestId("breakdown-safe");
  await expect(safe).toBeVisible();
  await expect(safe.getByTestId("safe-low-total")).toContainText("Lowest point");
  await expect(safe).not.toContainText("does not add up");
  const predicted = page.getByTestId("upcoming-charges").first();
  await expect(predicted).toBeVisible();
  await openAndSum(predicted);
});
