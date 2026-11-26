import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { currentMonthIndex, db } from "../helpers/seed";

test("connected accounts set spending, and a missing rate is typed right on the dashboard", async ({
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

  const { db: d, close } = db();
  try {
    const { createDebt, createPerson, findHouseholdIdForUser, scopeFor } = await import("@fire/db");
    const scope = scopeFor((await findHouseholdIdForUser(d, user.userId))!);
    await createPerson(d, scope, { name: "Alex", birthMonth: currentMonthIndex() - 35 * 12 });
    for (const name of ["Store card", "Family loan"]) {
      await createDebt(d, scope, {
        name,
        kind: "other",
        balanceCents: 300_000,
        apr: null,
        minPaymentRule: { type: "fixed", amount: 50 },
      });
    }
  } finally {
    await close();
  }

  await page.goto("/dashboard");
  // Spending comes from the connected bank; the plan never asks for it.
  await expect(page.getByText(/Enter your annual spending/)).toHaveCount(0);
  await expect(page.getByText(/from your accounts/)).toBeVisible();

  // Each debt without a rate has its own box, the first already focused.
  const boxes = page.getByTestId("rate-entry").locator("input[name=apr]");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first()).toBeFocused();
  await expect(page.getByRole("link", { name: "Fix" })).toHaveCount(0);

  // Bad input stays put with a message.
  await page.keyboard.type("lots");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: /percentage/ })).toBeVisible();
  await expect(boxes.first()).toHaveValue("lots");

  // Type, Enter, and focus moves to the next box.
  await boxes.first().fill("19.5");
  await page.keyboard.press("Enter");
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).toBeFocused();
  await page.keyboard.type("7");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("rate-entry")).toHaveCount(0);

  await page.goto("/debts");
  await expect(page.getByText("19.5% APR (entered by you)")).toBeVisible();
  await expect(page.getByText("7% APR (entered by you)")).toBeVisible();
});
