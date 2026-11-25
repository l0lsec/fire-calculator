import { defineConfig } from "vitest/config";

// One project per package so a gate can run exactly the suite it measures.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "engine", include: ["packages/engine/test/**/*.test.ts"], testTimeout: 30000 } },
      { test: { name: "spending", include: ["packages/spending/test/**/*.test.ts"] } },
      { test: { name: "plaid", include: ["packages/plaid/test/**/*.test.ts"] } },
      {
        test: {
          name: "db",
          include: ["packages/db/test/**/*.test.ts"],
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
      "apps/web/vitest.config.ts",
    ],
  },
});
