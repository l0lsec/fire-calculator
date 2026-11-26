// Phase 5: every page, not just the dashboard, passes axe (no serious or
// critical violations) at phone and desktop widths, without sideways scroll.
import { expect, test } from "@playwright/test";
import { seriousViolations } from "../helpers/a11y";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { seedWorkedExample } from "../helpers/seed";

const PAGES = [
  "/dashboard",
  "/setup",
  "/plan",
  "/debts",
  "/spending",
  "/budgets",
  "/bills",
  "/scenarios",
  "/history",
  "/accounts",
  "/connections",
  "/connect",
  "/alerts",
];

test("every app page has no serious accessibility violations at 375 and 1280", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: {
      public_token: await fakePlaid.publicToken(),
      institution: { id: "ins_fixture", name: "Fixture Bank" },
    },
  });
  const failures: string[] = [];
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      for (const v of await seriousViolations(page)) failures.push(`${path} @${width}: ${v}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`${path} @${width}: scrolls sideways by ${overflow}px`);
    }
  }
  expect(failures).toEqual([]);
});

test("sign-in and sign-up have no serious accessibility violations at 375 and 1280", async ({ page }) => {
  const failures: string[] = [];
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(path);
      for (const v of await seriousViolations(page)) failures.push(`${path} @${width}: ${v}`);
    }
  }
  expect(failures).toEqual([]);
});
