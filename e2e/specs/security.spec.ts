import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { seedWorkedExample } from "../helpers/seed";

test("pages render under the strict CSP with nonced scripts and no violations", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createVerifiedUser();
  await seedWorkedExample(user.userId, { withDebts: true });
  await signInContext(context, user, baseURL as string);
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply|connect|frame)/i.test(m.text()))
      violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  for (const path of [
    "/dashboard",
    "/debts",
    "/plan",
    "/accounts",
    "/spending",
    "/scenarios",
    "/history",
    "/connections",
    "/connect",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const csp = res?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, path).toBeTruthy();
    // Every script Next rendered carries this response's nonce.
    const scripts = await page
      .locator("script")
      .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const n of scripts) expect(n, path).toBe(nonce);
    await page.waitForLoadState("load");
  }
  // The debt planner (client-side engine) still works under CSP.
  await page.goto("/debts");
  await expect(page.getByTestId("debt-free-date")).toBeVisible();
  expect(violations).toEqual([]);
});
