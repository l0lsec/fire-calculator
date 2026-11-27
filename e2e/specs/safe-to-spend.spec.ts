import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";

const dollars = (s: string | null) => Number((s ?? "").replace(/[$,]/g, ""));

test("safe to spend forecasts the connected checking account and follows the cushion", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: { public_token: await fakePlaid.publicToken(), institution: null },
  });
  expect(ex.status()).toBe(200);

  // Reached as a tab of Spending.
  await page.goto("/spending");
  await page.getByRole("link", { name: "Safe to spend" }).click();
  await expect(page).toHaveURL(/\/safe-to-spend$/);
  await expect(page.getByRole("heading", { name: "Safe to spend", level: 1 })).toBeVisible();

  const amount = page.getByTestId("safe-amount");
  await expect(amount).toHaveText(/^\$[\d,]+(\.\d\d)?$/);
  // The fixture's monthly pay and bills are found and laid out with a running balance.
  const upcoming = page.getByTestId("safe-upcoming").locator("li");
  await expect(upcoming.first()).toBeVisible();
  expect(await upcoming.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("safe-accounts")).toContainText("Spending accounts");

  // No cushion: at least as much as before. A cushion above every balance: nothing is safe.
  const cushion = page.getByTestId("cushion-form");
  const before = dollars(await amount.textContent());
  await cushion.getByLabel("Always keep at least ($)").fill("0");
  await cushion.getByRole("button", { name: "Save cushion" }).click();
  await expect(cushion).toContainText("Cushion set to $0.00");
  await page.reload();
  const loose = dollars(await page.getByTestId("safe-amount").textContent());
  expect(loose).toBeGreaterThanOrEqual(before);

  await page.getByTestId("cushion-form").getByLabel("Always keep at least ($)").fill("1,000,000");
  await page.getByTestId("cushion-form").getByRole("button", { name: "Save cushion" }).click();
  await expect(page.getByTestId("cushion-form")).toContainText("Safe to spend is now $0.00");
  await page.reload();
  await expect(page.getByTestId("safe-amount")).toHaveText("$0");

  // The dashboard carries the same figure.
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-safe")).toContainText("$0");
});

test("a bill added by hand is counted on its date, and Remove can be undone", async ({
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
  await page.goto("/safe-to-spend");
  const amount = async () => dollars(await page.getByTestId("safe-amount").textContent());
  const before = await amount();
  const upcoming = page.getByTestId("safe-upcoming");

  // A typo is caught and the typed values stay.
  const form = page.getByTestId("bill-form");
  await form.getByLabel("Name").fill("Life insurance premium");
  await form.getByLabel("Amount ($)").fill("lots");
  await form.getByRole("button", { name: "Add bill" }).click();
  await expect(form).toContainText("Enter a dollar amount");
  await expect(form.getByLabel("Name")).toHaveValue("Life insurance premium");

  // Due tomorrow (the tests pin today to Nov 25), so it falls before payday.
  await form.getByLabel("Amount ($)").fill("1,000,000");
  await form.getByLabel("Next due").fill("2026-11-26");
  await form.getByRole("button", { name: "Add bill" }).click();
  await expect(form).toContainText("Added Life insurance premium. Safe to spend is now $0.00");
  await page.reload();
  await expect(page.getByTestId("safe-bills")).toContainText("Life insurance premium");
  await expect(upcoming).toContainText("added by you");
  await expect(page.getByTestId("safe-amount")).toHaveText("$0");

  // Remove takes it out; Undo puts it back.
  const bills = page.getByTestId("safe-bills");
  await bills.getByRole("button", { name: "Remove" }).click();
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Removed Life insurance premium.");
  await expect.poll(amount).toBe(before);
  await toast.getByTestId("toast-undo").click();
  await expect(page.getByTestId("safe-bills")).toContainText("Life insurance premium");
  await expect.poll(amount).toBe(0);
});

test("an account that would go below zero gets a plan to move money in, and the fees it avoids are kept", async ({
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
  await page.goto("/safe-to-spend");
  // Checking holds 8,300 and savings 22,000: a 10,000 bill tomorrow overdraws checking.
  const form = page.getByTestId("bill-form");
  await form.getByLabel("Name").fill("Roof repair");
  await form.getByLabel("Amount ($)").fill("10,000");
  await form.getByLabel("How often").selectOption("yearly");
  await form.getByLabel("Next due").fill("2026-11-26");
  await form.getByRole("button", { name: "Add bill" }).click();
  await expect(form).toContainText("Added Roof repair.");
  await page.reload();

  const plan = page.getByTestId("move-plan");
  await expect(plan).toContainText(
    /Move \$[\d,]+ from High Yield Savings \.\.\.2222 to Everyday Checking \.\.\.1111 by/,
  );
  await expect(plan.getByTestId("move-fees")).toContainText(
    /Avoids about \$[\d,]+ in fees: \d+ charges would come out below \$0, at \$35\.00 each \(a typical bank fee\)/,
  );
  await page.getByRole("link", { name: "See the plan to avoid overdraft fees" }).click();
  await expect(page).toHaveURL(/#moves$/);

  // The plan opens what it is made of, and every step adds up.
  await plan.getByTestId("move-drill").click();
  await expect(plan.getByTestId("move-need-total")).toContainText("To move");
  await expect(plan.getByTestId("move-fees-total")).toContainText("Fees avoided");
  await expect(plan).not.toContainText("does not add up");

  // I moved it: the forecast counts it, the plan goes away and the fees avoided are kept.
  await plan.getByTestId("move-record").click();
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText(
    /Counted the \$[\d,.]+ move\. Everyday Checking's lowest point is now \$[\d,.]+\./,
  );
  await page.reload();
  await expect(page.getByTestId("move-plan")).toHaveCount(0);
  const list = page.getByTestId("moves-list");
  await expect(list).toContainText("counted in the forecast until it shows up");
  await expect(page.getByTestId("safe-upcoming")).toContainText("a move you made");
  const saved = page.getByTestId("fees-saved");
  await expect(saved).toContainText(/\$[1-9][\d,]*/);
  await saved.getByTestId("fees-saved-drill").click();
  await expect(saved.getByTestId("fees-saved-total")).toContainText("Fees avoided");
  await expect(saved).not.toContainText("does not add up");

  // Remove takes it out of the forecast; Undo puts it back.
  await list.getByTestId("move-remove").click();
  await expect(page.getByTestId("toast")).toContainText("The forecast no longer counts it.");
  await page.getByTestId("toast").getByTestId("toast-undo").click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("moves-list")).toContainText("counted in the forecast");
  await expect(page.getByTestId("move-plan")).toHaveCount(0);
});
