import { expect, test } from "@playwright/test";
import { monthName } from "../../apps/web/src/lib/format";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { currentMonthIndex, seedWorkedExample, workedExample } from "../helpers/seed";

test("moving the slider updates the debt-free date without a network request", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  const date = page.getByTestId("debt-free-date");
  await expect(date).toHaveText(monthName(currentMonthIndex() + 42));
  // Let navigation prefetches settle; the assertion is about the slider alone.
  await page.waitForTimeout(2500);

  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const slider = page.getByTestId("extra-slider");
  await slider.focus();
  for (let i = 0; i < 20; i++) await slider.press("ArrowRight");
  await expect(date).not.toHaveText(monthName(currentMonthIndex() + 42));
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test("the comparison table shows the worked example's months and interest", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  const ex = workedExample().expected as Record<string, { months: number; totalInterest: number }>;
  const fmt = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await expect(page.getByTestId("strategy-months-avalanche")).toHaveText(`${ex.avalanche?.months} months`);
  await expect(page.getByTestId("strategy-months-snowball")).toHaveText(`${ex.snowball?.months} months`);
  await expect(page.getByTestId("strategy-interest-avalanche")).toHaveText(
    fmt(ex.avalanche?.totalInterest as number),
  );
  await expect(page.getByTestId("strategy-interest-snowball")).toHaveText(
    fmt(ex.snowball?.totalInterest as number),
  );
});
