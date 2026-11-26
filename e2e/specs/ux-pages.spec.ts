// Phase 3 of the UX rollout (docs/ux-rollout/PLAN.md): one test per area,
// each checking what its leaf ledger promises.
import { expect, type Page, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { fakePlaid } from "../helpers/fake-plaid";
import { seedWorkedExample } from "../helpers/seed";

const MONTH = /[A-Z][a-z]{2} \d{4}/;

async function connectBank(page: Page) {
  await page.goto("/dashboard"); // creates the household
  const ex = await page.request.post("/api/plaid/link/exchange", {
    data: {
      public_token: await fakePlaid.publicToken(),
      institution: { id: "ins_fixture", name: "Fixture Bank" },
    },
  });
  expect(ex.status()).toBe(200);
}

/** True when `a` comes before `b` in the document. */
async function before(page: Page, a: string, b: string) {
  return page.evaluate(
    ([x, y]) => {
      const ea = document.querySelector(x as string);
      const eb = document.querySelector(y as string);
      return Boolean(ea && eb && ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    [a, b],
  );
}

test("3a dashboard: the setup checklist counts done steps and the headline comes before detail", async ({
  page,
  context,
  baseURL,
}) => {
  const fresh = await createVerifiedUser();
  await signInContext(context, fresh, baseURL as string);
  await page.goto("/dashboard");
  const card = page.getByTestId("setup-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("progress-count")).toHaveText("0 of 4 done");
  await expect(card.getByTestId("step-list").locator("li")).toHaveCount(4);
  await expect(card.getByRole("link", { name: "Start setup" })).toBeVisible();

  await context.clearCookies();
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard");
  await expect(page.getByTestId("setup-card")).toHaveCount(0);
  await expect(page.getByTestId("fi-when")).toHaveText(MONTH);
  expect(await before(page, '[data-testid="fi-when"]', '[data-testid="fi-ladder"]')).toBe(true);
});

test("3b plan: advanced assumptions start collapsed and the essentials are visible", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId);
  await signInContext(context, user, baseURL as string);
  await page.goto("/plan");
  const more = page.getByTestId("more-assumptions");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Investment return (%/yr)")).toBeVisible();
  await expect(page.getByLabel("Cash return (%/yr)")).toBeHidden();
  await more.locator("summary").click();
  await expect(page.getByLabel("Cash return (%/yr)")).toBeVisible();
});

test("3c spending: the review shows items left and one suggested choice per row", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await connectBank(page);
  await page.goto("/spending");
  await expect(page.getByRole("heading", { name: /^Review: \d+ left$/ })).toBeVisible();
  const rows = page.getByTestId("review-queue").locator("li");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(rows.nth(i).getByTestId("review-suggested")).toHaveCount(1);
});

test("3d debts: the planner names the cheapest strategy and why", async ({ page, context, baseURL }) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  await page.goto("/debts");
  const rec = page.getByTestId("strategy-recommendation");
  await expect(rec).toContainText("Costs least:");
  await expect(rec).toContainText(/saves \$[\d,]+ in interest|costs no more interest/);
  await expect(page.locator('[data-testid^="strategy-row-"]').getByText("costs least")).toHaveCount(1);
});

test("3e connections: linking a bank ends on the bank, its account count and the next step", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await page.goto("/dashboard"); // creates the household
  const token = await fakePlaid.publicToken();
  // Stand in for Plaid Link's window: it hands back a public token at once.
  await page.addInitScript((publicToken) => {
    (window as unknown as { Plaid: unknown }).Plaid = {
      create: (opts: { onSuccess: (t: string, m: unknown) => void }) => ({
        open: () =>
          opts.onSuccess(publicToken, {
            institution: { institution_id: "ins_fixture", name: "Fixture Bank" },
          }),
        destroy: () => {},
      }),
    };
  }, token);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Connect a bank" }).click();
  await expect(
    page.getByText(/^Linked Fixture Bank: \d+ accounts?\. The first sync is running\./),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Review your spending next" })).toBeVisible();

  await page.goto("/connections");
  await expect(page.getByTestId("item-status")).toHaveText("Connected");
  await expect(page.getByText(/UTC/)).toHaveCount(0);
  await expect(page.getByText(/last updated [A-Z][a-z]{2} \d{1,2}/)).toBeVisible();
});

test("3f auth: a wrong password and a wrong code get plain messages, and two-step setup shows its steps", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("Wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("That email and password do not match. Check both and try again."),
  ).toBeVisible();

  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(`steps-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill(`Steps${Math.random().toString(36).slice(2, 8)}A1`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/mfa/);
  await expect(page.getByText("Step 1 of 2: scan the code")).toBeVisible();
  await expect(page.getByText("Step 2 of 2: enter the 6-digit code")).toBeVisible();
  await expect(page.getByLabel("Verification code")).toBeFocused();
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/That code did not match/)).toBeVisible();
});

test("3g alerts and history: every alert has one action, and export says it started", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await connectBank(page);
  await page.goto("/alerts");
  await page.getByLabel("Low balance under").fill("1,000,000");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  const alerts = page.getByTestId("alert");
  const n = await alerts.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(alerts.nth(i).getByRole("button")).toHaveCount(1);
  // Dismiss is undoable.
  const title = (await alerts.first().locator("p.font-medium").textContent())?.trim() ?? "";
  await alerts.first().getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("alert").filter({ hasText: title })).toHaveCount(0);
  await page.getByTestId("toast-undo").click();
  await expect(page.getByTestId("alert").filter({ hasText: title })).toHaveCount(1);

  await page.goto("/history");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Accounts (CSV)" }).click();
  await download;
  await expect(page.getByTestId("toast")).toContainText("Downloading your accounts as CSV");
});
