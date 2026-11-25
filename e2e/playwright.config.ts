import { defineConfig, devices } from "@playwright/test";

// Runs against the production build (`next build` first; the gate scripts do it).
// The app reads the repo's .env (local Supabase stack, local Postgres); Plaid
// calls go to the fake API started in global-setup.ts.
const PORT = Number(process.env.E2E_PORT ?? 3199);
const FAKE_PLAID_PORT = Number(process.env.FAKE_PLAID_PORT ?? 3298);

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
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
      PLAID_CLIENT_ID: "fake_client_id",
      PLAID_SECRET: "fake_secret",
      PLAID_ENV: "sandbox",
      // Fixtures are dated; pin the app's "today" so these tests do not expire.
      FIRE_AS_OF: "2026-11-25",
      PLAID_BASE_URL: `http://127.0.0.1:${FAKE_PLAID_PORT}`,
      PLAID_WEBHOOK_URL: `http://127.0.0.1:${PORT}/api/plaid/webhook`,
    },
  },
});
