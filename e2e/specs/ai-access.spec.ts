// AI access, end to end: create a key on the page, see it once with the setup
// filled in, drive the MCP endpoint and the REST API with it from a client that
// has no session, then revoke it (Undo brings it back).
import { expect, test } from "@playwright/test";
import { createVerifiedUser, signInContext } from "../helpers/auth";
import { seedWorkedExample } from "../helpers/seed";

const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

test("AI access: create a key, use it over MCP and REST, revoke and undo", async ({
  page,
  context,
  baseURL,
  playwright,
}) => {
  const user = await createVerifiedUser();
  await signInContext(context, user, baseURL as string);
  await seedWorkedExample(user.userId, { withDebts: true });

  await page.goto("/ai-access");
  await expect(page.getByRole("heading", { name: "AI access" })).toBeVisible();
  // It is a tab of Accounts, not a new place.
  await expect(
    page.getByRole("navigation", { name: "Accounts sections" }).getByRole("link", { name: "AI access" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No keys yet.")).toBeVisible();

  // Empty name keeps the form and says how to fix it.
  await page.getByLabel("Name").fill("");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Name the key, for example Claude")).toBeVisible();

  await page.getByLabel("Name").fill("Claude Code e2e");
  await page.getByRole("button", { name: "Create key" }).click();
  const secret = (await page.getByTestId("new-key-secret").innerText()).trim();
  expect(secret).toMatch(/^fire_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Copy it now: it is shown only once.")).toBeVisible();
  // The setup for Claude Code already carries the key and this server's address.
  const snippet = await page.getByTestId("new-key").getByTestId("snippet-claude-code").innerText();
  expect(snippet).toContain(secret);
  expect(snippet).toContain(`${baseURL}/api/mcp`);
  await page.screenshot({ path: "test-results/ai-access-created.png", fullPage: true });

  // A client with no cookies: only the key.
  const api = await playwright.request.newContext({ baseURL: baseURL as string });
  const auth = { authorization: `Bearer ${secret}` };
  expect((await api.post("/api/mcp", { data: rpc(1, "tools/list") })).status()).toBe(401);

  const init = await api.post("/api/mcp", {
    headers: auth,
    data: rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "e2e" },
    }),
  });
  expect(init.status()).toBe(200);
  expect((await init.json()).result.serverInfo.name).toBe("fire-planner");
  expect(
    (
      await api.post("/api/mcp", {
        headers: auth,
        data: { jsonrpc: "2.0", method: "notifications/initialized" },
      })
    ).status(),
  ).toBe(202);

  const list = await (await api.post("/api/mcp", { headers: auth, data: rpc(2, "tools/list") })).json();
  const names = list.result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("get_overview");
  expect(names).not.toContain("create_scenario"); // read-only by default

  const overview = await (
    await api.post("/api/mcp", {
      headers: auth,
      data: rpc(3, "tools/call", { name: "get_overview", arguments: {} }),
    })
  ).json();
  expect(overview.result.isError).toBeUndefined();
  expect(overview.result.structuredContent.headline.fiTarget).toBeGreaterThan(0);

  const rest = await api.get("/api/v1/tools/list_debts", { headers: auth });
  expect(rest.status()).toBe(200);
  expect(Array.isArray((await rest.json()).result)).toBe(true);
  expect((await api.get("/api/v1/openapi.json", { headers: auth })).status()).toBe(200);

  // The list shows it, with who used it last.
  await page.reload();
  const row = page.getByTestId("key-list").locator("li", { hasText: "Claude Code e2e" });
  await expect(row).toContainText("read only");
  await expect(row).toContainText("by Claude Code");
  await page.screenshot({ path: "test-results/ai-access-list.png", fullPage: true });

  // Revoke: no confirmation (Undo reverses it), access stops at once.
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(/Revoked "Claude Code e2e"/)).toBeVisible();
  expect((await api.post("/api/mcp", { headers: auth, data: rpc(4, "ping") })).status()).toBe(401);
  await page.getByTestId("toast-undo").click();
  await expect(page.getByText("Undone.")).toBeVisible();
  expect((await api.post("/api/mcp", { headers: auth, data: rpc(5, "ping") })).status()).toBe(200);
  await api.dispose();
});
