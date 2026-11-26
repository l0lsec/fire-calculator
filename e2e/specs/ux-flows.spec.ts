// Phase 4 of the UX rollout: the laws that live between pages. A first run
// that shows its progress and resumes, saves that end on their effect, and
// forms that submit with Enter.
import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { currentMonthIndex, db, seedWorkedExample } from "../helpers/seed";

const MOVE =
  /FI date moved (?:\d+ yr )?(?:\d+ mo )?(earlier|later): ([A-Z][a-z]{2} \d{4}) to ([A-Z][a-z]{2} \d{4})\./;

test("setup: a new household goes through four visible steps to an FI date, and resumes where it left off", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Start setup" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  const step = page.getByTestId("setup-step");
  await expect(step).toHaveText("Step 1 of 4: Add yourself");
  await expect(page.getByTestId("progress-count")).toHaveText("0 of 4 done");

  await page.getByLabel("Name").fill("Sam");
  await page.getByLabel("Birth month").fill(`${new Date().getFullYear() - 34}-04`);
  await page.getByRole("button", { name: "Add person" }).click();
  // A finished step moves straight on to the next unfinished one.
  await expect(page.getByTestId("progress-count")).toHaveText("1 of 4 done");
  await expect(step).toHaveText("Step 2 of 4: Connect a bank or enter what you spend");
  // Done steps can be revisited, and say what is there.
  await page.getByRole("link", { name: /Add yourself/ }).click();
  await expect(step).toHaveText("Step 1 of 4: Add yourself");
  await expect(page.getByTestId("setup-people")).toContainText("Sam");
  await page.getByRole("link", { name: /^Next: / }).click();
  await expect(step).toHaveText("Step 2 of 4: Connect a bank or enter what you spend");

  // Leave mid-way; coming back resumes at the first unfinished step.
  await page.goto("/dashboard");
  await expect(page.getByTestId("setup-card").getByTestId("progress-count")).toHaveText("1 of 4 done");
  await page.getByRole("link", { name: "Continue setup" }).click();
  await expect(step).toHaveText("Step 2 of 4: Connect a bank or enter what you spend");

  await page.getByLabel("Annual living spending").fill("48,000");
  await page.getByLabel("Of which essentials").fill("30,000");
  await page.getByRole("button", { name: "Save spending" }).click();
  await expect(page.getByTestId("progress-count")).toHaveText("2 of 4 done");
  await expect(step).toHaveText("Step 3 of 4: Add your take-home pay");

  await page.getByLabel("Name").fill("Salary");
  await page.getByLabel("Monthly amount (after tax)").fill("6,500");
  await page.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByTestId("progress-count")).toHaveText("3 of 4 done");
  await expect(step).toHaveText("Step 4 of 4: Add your savings and investments");

  // Connecting is the main way; adding by hand is for what cannot be connected.
  await expect(page.getByRole("link", { name: "Connect a bank or brokerage" })).toBeVisible();
  await page.getByText("Add an account that can't be connected").click();
  await page.getByLabel("Name").fill("Index funds");
  await page.getByLabel("Type").selectOption("taxable");
  await page.getByLabel("Balance").fill("60,000");
  await page.getByRole("button", { name: "Add account" }).click();
  // The end of the flow: the FI date, and the way on.
  const done = page.getByTestId("setup-done");
  await expect(page.getByRole("heading", { name: "You are set up" })).toBeVisible();
  const when = (await done.getByTestId("setup-fi-when").textContent())?.trim() ?? "";
  expect(when).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  await done.getByRole("link", { name: "See your dashboard" }).click();
  await expect(page.getByTestId("fi-when")).toHaveText(when);
  await expect(page.getByTestId("setup-card")).toHaveCount(0);
});

test("saves report how the FI date moved, and the dashboard agrees", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  const start = (await page.getByTestId("fi-when").textContent())?.trim() ?? "";

  // Assumptions: a higher return brings FI earlier.
  await page.goto("/plan");
  const ret = page.getByLabel("Investment return (%/yr)");
  await ret.fill(String(Number(await ret.inputValue()) + 2));
  await page.getByRole("button", { name: "Save assumptions" }).click();
  const msg = page.getByText(MOVE);
  await expect(msg).toBeVisible();
  const [, dir, from, to] = ((await msg.textContent()) ?? "").match(MOVE) ?? [];
  expect(dir).toBe("earlier");
  expect(from).toBe(start);
  await page.goto("/dashboard");
  await expect(page.getByTestId("fi-when")).toHaveText(to as string);

  // A debt rate typed on the dashboard says what it did to the date.
  const { db: d, close } = db();
  try {
    const { createDebt, findHouseholdIdForUser, scopeFor } = await import("@fire/db");
    const scope = scopeFor((await findHouseholdIdForUser(d, user.userId))!);
    await createDebt(d, scope, {
      name: "Store card",
      kind: "other",
      balanceCents: 900_000,
      apr: null,
      minPaymentRule: { type: "fixed", amount: 150 },
    });
  } finally {
    await close();
  }
  await page.goto("/dashboard");
  const box = page.getByTestId("rate-entry").locator("input[name=apr]");
  await box.fill("24");
  await box.press("Enter");
  await expect(page.getByTestId("toast")).toContainText(
    /Store card: Rate saved\. (FI date|Your FI date|FI is)/,
  );
});

test("a spending decision reports how the FI date moved", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  const { db: d, close } = db();
  try {
    const { createPerson, findHouseholdIdForUser, scopeFor } = await import("@fire/db");
    const scope = scopeFor((await findHouseholdIdForUser(d, user.userId))!);
    await createPerson(d, scope, { name: "Alex", birthMonth: currentMonthIndex() - 35 * 12 });
  } finally {
    await close();
  }
  await page.goto("/spending");
  const row = page.getByTestId("review-queue").locator("li", { hasText: "HOME FURNISHINGS CO" });
  await row.getByRole("button", { name: "One-time" }).click();
  await expect(page.getByTestId("toast")).toContainText(
    /one-time, left out of yearly spending\. (FI|Your FI)/,
  );
});

test("Enter submits a form from any field", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/plan");
  const income = page.locator("section", { has: page.getByRole("heading", { name: "Income" }) });
  await income.getByLabel("Name").fill("Dividends");
  await income.getByLabel("Monthly amount (after tax)").fill("250");
  await income.getByLabel("Monthly amount (after tax)").press("Enter");
  await expect(income.getByText(/^Added Dividends\./)).toBeVisible();

  const people = page.locator("section", { has: page.getByRole("heading", { name: "People" }) });
  await people.getByLabel("Name").fill("Jo");
  await people.getByLabel("Birth month").fill("1990-02");
  await people.getByLabel("Birth month").press("Enter");
  await expect(people.getByText("born 1990-02")).toBeVisible();
});
