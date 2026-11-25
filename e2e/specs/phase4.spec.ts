import {
  createHouseholdForUser,
  createIncomeStream,
  createManualAccount,
  createPerson,
  scopeFor,
  setSpendingProfile,
} from "@fire/db";
import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { currentMonthIndex, db, seedWorkedExample } from "../helpers/seed";

test("scenarios render success rates and a traditional-heavy early FI shows the access warning", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  const { db: d, close } = db();
  try {
    const scope = scopeFor(await createHouseholdForUser(d, user.userId, "Early"));
    const p = await createPerson(d, scope, { name: "Riley", birthMonth: currentMonthIndex() - 40 * 12 });
    await createManualAccount(d, scope, {
      name: "401(k)",
      type: "manual",
      bucket: "traditional",
      currentCents: 2_400_000_00,
    });
    await createIncomeStream(d, scope, {
      personId: p.id,
      name: "Pay",
      kind: "takeHome",
      monthlyCents: 9_000_00,
      phase: "working",
      growth: "raise",
    });
    await setSpendingProfile(d, scope, {
      source: "manual",
      manualAnnualCents: 60_000_00,
      manualEssentialCents: 40_000_00,
    });
  } finally {
    await close();
  }
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await expect(page.getByTestId("access-warning")).toBeVisible();
  await expect(page.getByTestId("access-warning")).toContainText("Roth conversion ladder");

  await page.goto("/scenarios");
  await expect(page.getByTestId("compare-table")).toBeVisible();
  await expect(page.getByTestId("success-rate").first()).toHaveText(/^\d{1,3}%$/);
  await expect(page.getByTestId("historical-success").first()).toHaveText(/^\d{1,3}% of \d+ start years$/);
});

test("the JSON export downloads the plan without any tokens", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  const res = await page.request.get("/api/export?format=json");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="fire-plan-/);
  const body = await res.text();
  const json = JSON.parse(body);
  expect(json.version).toBe(1);
  expect(json.debts).toHaveLength(4);
  expect(body).not.toMatch(/access-(sandbox|production)/);
  const csv = await page.request.get("/api/export?format=csv&kind=debts");
  expect((await csv.text()).split("\n")[0]).toBe("name,kind,balance,apr");
});
