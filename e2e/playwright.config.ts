import { defineConfig, devices } from "@playwright/test";

// Runs against the production build (`next build` first; the gate scripts do it).
// The app reads the repo's .env (local Supabase stack, local Postgres).
const PORT = Number(process.env.E2E_PORT ?? 3199);

export default defineConfig({
  testDir: "./specs",
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
    env: { ...(process.env as Record<string, string>) },
  },
});
