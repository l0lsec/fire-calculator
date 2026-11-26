// The charts on Dashboard, Debts, Scenarios, History and Spending render with a
// legend or a heading, a hover tooltip and a table view (docs/UX_PRINCIPLES.md law 12;
// the dataviz rules: identity never rests on color alone, tooltips never gate).
import {
  createScenario,
  getBaselineScenario,
  type HouseholdScope,
  listAccounts,
  recordSnapshot,
} from "@fire/db";
import { expect, type Locator, test } from "@playwright/test";
import { seriousViolations } from "../helpers/a11y";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { db, seedWorkedExample } from "../helpers/seed";

/** A what-if that saves less is slower to FI; two balance days give History a line. */
async function addScenarioAndHistory(scope: HouseholdScope) {
  const { db: d, close } = db();
  try {
    const base = (await getBaselineScenario(d, scope))!;
    await createScenario(d, scope, {
      name: "Retire at 50",
      isBaseline: false,
      assumptions: { ...(base.assumptions as object), swr: 0.035 },
      debtPlan: base.debtPlan,
      policy: base.policy,
      retirementAdjustments: base.retirementAdjustments,
    });
    const [account] = await listAccounts(d, scope);
    await recordSnapshot(d, scope, account!.id, "2026-09-01", 30_000_00);
    await recordSnapshot(d, scope, account!.id, "2026-10-01", 32_000_00);
  } finally {
    await close();
  }
}

/** Hovering the chart's plot shows a tooltip with a dollar value. */
async function expectTooltip(chart: Locator) {
  const plot = chart.locator(".recharts-wrapper").first();
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  await plot.hover({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
  await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText("$");
}

/** The table view opens and has at least `rows` data rows. */
async function expectTable(chart: Locator, rows: number) {
  await chart.getByText("Show as a table").click();
  expect(await chart.locator("tbody tr").count()).toBeGreaterThanOrEqual(rows);
}

test("plan charts: income by month, payment split, scenario bars and net worth history", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  const scope = await seedWorkedExample(user.userId, { withDebts: true });
  await addScenarioAndHistory(scope);
  await signInContext(context, user, baseURL as string);

  await page.goto("/dashboard");
  const income = page.getByTestId("income-by-month");
  await expect(income).toBeVisible();
  for (const name of ["Saved", "Living spending", "Debt interest"])
    await expect(income.getByRole("listitem").filter({ hasText: name })).toHaveCount(1);
  await expectTooltip(income);
  await expect(income.locator(".recharts-tooltip-wrapper")).toContainText("Income");
  await expectTable(income, 12);

  await page.goto("/debts");
  const split = page.getByTestId("debt-payment-split");
  await expect(split).toBeVisible();
  await expect(split.getByText("Interest", { exact: true }).first()).toBeVisible();
  await expectTooltip(split);
  await expectTable(split, 2);

  await page.goto("/scenarios");
  const when = page.getByTestId("scenario-fi-date-chart");
  const what = page.getByTestId("scenario-fi-number-chart");
  await expect(when).toBeVisible();
  await expect(what).toBeVisible();
  // One bar per scenario, each named on the axis.
  await expect(when.locator(".recharts-bar-rectangle")).toHaveCount(2);
  await expect(when.getByText("Retire at 50").first()).toBeVisible();
  await expectTable(what, 2);

  await page.goto("/history");
  const balances = page.getByTestId("history-balances");
  await expect(balances).toBeVisible();
  await expect(balances.getByText("Counted toward FI").first()).toBeVisible();
  await expectTooltip(balances);
  expect(await seriousViolations(page)).toEqual([]);
});

test("spending charts: essentials vs discretionary by month, category trends, money in and out", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard"); // creates the household
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  expect(ex.status()).toBe(200);

  await page.goto("/spending");
  const monthly = page.getByTestId("spending-monthly");
  await expect(monthly).toBeVisible();
  await expect(monthly.getByText("Essentials", { exact: true }).first()).toBeVisible();
  await expect(monthly.getByText("Discretionary", { exact: true }).first()).toBeVisible();
  await expectTooltip(monthly);
  await expect(monthly.locator(".recharts-tooltip-wrapper")).toContainText("Spent");
  await expectTable(monthly, 12);

  const trends = page.getByTestId("spending-category-trends");
  await expect(trends).toBeVisible();
  expect(await trends.getByTestId("category-trend").count()).toBeGreaterThan(1);
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto("/history");
  const inOut = page.getByTestId("history-in-out");
  await expect(inOut).toBeVisible();
  await expect(inOut.getByText("Income", { exact: true }).first()).toBeVisible();
  await expectTooltip(inOut);
});
