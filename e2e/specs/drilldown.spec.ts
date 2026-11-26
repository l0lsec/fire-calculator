// Every summary number opens what it is made of, in place (docs/UX_PRINCIPLES.md laws 5 and 19).
import { expect, type Locator, test } from "@playwright/test";
import { seriousViolations } from "../helpers/a11y";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { seedWorkedExample } from "../helpers/seed";

const dollars = async (l: Locator) => Number((await l.textContent())?.replace(/[^0-9.-]/g, ""));

test("savings rate opens income, spending and what is saved, and the numbers match the tile", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");

  const tile = page.getByTestId("tile-savings-rate");
  await expect(tile).toHaveAttribute("aria-expanded", "false");
  expect((await tile.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
  await tile.click();
  await expect(tile).toHaveAttribute("aria-expanded", "true");

  const panel = page.getByTestId("breakdown-savings-rate");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("sr-income")).toContainText("Pay");
  await expect(panel.getByTestId("sr-spending")).toContainText("Living spending");
  const gross = await dollars(panel.getByTestId("sr-gross").locator("span.num"));
  const spending = await dollars(panel.getByTestId("sr-spending").locator("span.num"));
  const saved = await dollars(panel.getByTestId("sr-saved").locator("span.num"));
  expect(gross).toBeGreaterThan(spending);
  expect(saved).toBeGreaterThan(0);
  // The panel's rate (two decimals) rounds to the tile's whole percent.
  const tileRate = Number((await page.getByTestId("savings-rate").textContent())?.replace("%", ""));
  const panelRate = Number(
    (await panel.getByTestId("sr-rate").locator("span.num").textContent())?.replace("%", ""),
  );
  expect(Math.round(panelRate)).toBe(tileRate);
  await expect(panel.getByTestId("breakdown-savings-rate-chart")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Income on Plan" })).toHaveAttribute("href", "/plan#income");
  expect(page.url()).toContain("#savings-rate");

  // Tapping the tile again closes it; only one breakdown is open at a time.
  await page.getByTestId("tile-invested").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("breakdown-invested")).toBeVisible();
  await page.getByTestId("tile-invested").click();
  await expect(page.getByTestId("breakdown-invested")).toHaveCount(0);
});

test("invested toward FI lists each account with its bucket, adds up to the tile, and links to Accounts", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  // A link straight to a breakdown opens it.
  await page.goto("/dashboard#invested");

  const panel = page.getByTestId("breakdown-invested");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Brokerage")).toBeVisible();
  await expect(panel.getByText("Taxable investments", { exact: true }).first()).toBeVisible();
  const total = await dollars(panel.getByTestId("inv-total").locator("span.num"));
  expect(total).toBe(await dollars(page.getByTestId("fi-portfolio")));
  await panel.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // Accounts: "Counting toward FI" opens the same way.
  await page.getByTestId("tile-counting").click();
  const acct = page.getByTestId("breakdown-counting");
  await expect(acct.getByText("Brokerage")).toBeVisible();
  expect(await dollars(acct.getByTestId("acct-total").locator("span.num"))).toBe(
    await dollars(page.getByTestId("accounts-counting")),
  );
});

test("an FI ladder row opens how its target is built; open panels pass accessibility", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");

  const lean = page.getByTestId("ladder-lean").getByRole("button");
  await lean.click();
  await expect(lean).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByTestId("breakdown-ladder-lean");
  await expect(panel).toContainText("Essential spending");
  await expect(panel).toContainText("Withdrawal rate");

  await page.getByTestId("tile-fi-number").click();
  await expect(page.getByTestId("breakdown-fi-number")).toBeVisible();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await seriousViolations(page), `width ${width}`).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}`).toBeLessThanOrEqual(1);
  }
});
