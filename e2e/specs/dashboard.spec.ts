import { expect, test } from "@playwright/test";
import { monthName } from "../../apps/web/src/lib/format";
import { seriousViolations } from "../helpers/a11y";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { currentMonthIndex, seedWorkedExample, workedExample } from "../helpers/seed";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

test("dashboard shows the worked example's FI levels and dates", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  const ex = workedExample().expected as Record<string, number>;
  const start = currentMonthIndex();

  await expect(page.getByTestId("fi-target")).toHaveText(usd(ex.fi as number));
  await expect(page.getByTestId("fi-when")).toHaveText(monthName(start + (ex.fiMonths as number)));
  await expect(page.getByTestId("ladder-coast-target")).toHaveText(usd(ex.coastFIToday as number));
  await expect(page.getByTestId("ladder-coast-when")).toContainText(
    monthName(start + (ex.coastFIMonths as number)),
  );
  await expect(page.getByTestId("ladder-lean-target")).toHaveText(usd(ex.leanFI as number));
  await expect(page.getByTestId("ladder-fat-target")).toHaveText(usd(ex.fatFI as number));
  await expect(page.getByTestId("ladder-barista-target")).toHaveText(usd(ex.baristaFI as number));
  await expect(page.getByTestId("ladder-fi-when")).toContainText(monthName(start + (ex.fiMonths as number)));
  await expect(page.getByText("Not financial advice")).toBeVisible();
});

test("dashboard has no serious accessibility violations at 375 and 1280", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("fi-target")).toBeVisible();
    expect(await seriousViolations(page), `width ${width}`).toEqual([]);
    // No horizontal page scroll on phones.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}`).toBeLessThanOrEqual(1);
  }
});
