import { defineConfig, devices } from "@playwright/test";

// Real Plaid Sandbox (keys from .env). scripts/verify/sandbox-e2e.mjs opens an
// ngrok tunnel and passes its URL so Plaid can deliver webhooks.
const PORT = 3197;
const tunnel = process.env.E2E_TUNNEL_URL ?? "";

export default defineConfig({
  testDir: "./sandbox",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @fire/web exec next start --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...(process.env as Record<string, string>),
      PLAID_BASE_URL: "",
      PLAID_WEBHOOK_URL: tunnel ? `${tunnel}/api/plaid/webhook` : "",
    },
  },
});
