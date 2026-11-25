// Run Playwright specs against the production build and require that every
// named test passed (a skipped or renamed test cannot satisfy a gate).
import { assert, run } from "./lib.mjs";
import { ensureBuilt } from "./server.mjs";

export function playwright(files, requireTitles = []) {
  ensureBuilt();
  const r = run(
    "pnpm",
    ["exec", "playwright", "test", "-c", "e2e/playwright.config.ts", ...files, "--reporter=json"],
    {
      allowFail: true,
      quiet: true,
    },
  );
  const start = r.out.indexOf("{");
  let report;
  try {
    report = JSON.parse(r.out.slice(start));
  } catch {
    console.error(r.out.slice(-4000));
    assert(false, "playwright produced no JSON report");
  }
  const results = [];
  const walk = (suite) => {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
      const status = spec.tests.every((t) => t.results.some((x) => x.status === "passed"))
        ? "passed"
        : "failed";
      results.push({ title: spec.title, status });
      if (status !== "passed") {
        for (const t of spec.tests)
          for (const x of t.results)
            for (const e of x.errors ?? [])
              console.error(`${spec.title}: ${(e.message ?? "").split("\n").slice(0, 8).join("\n")}`);
      }
    }
  };
  for (const s of report.suites ?? []) walk(s);
  const failed = results.filter((x) => x.status !== "passed");
  assert(
    r.code === 0 && failed.length === 0,
    `playwright failures: ${failed.map((f) => f.title).join(", ")}`,
  );
  for (const title of requireTitles) {
    assert(
      results.some((x) => x.title === title && x.status === "passed"),
      `required e2e test did not pass: "${title}"`,
    );
  }
  console.log(`playwright: ${results.length} passed (${files.join(", ")})`);
}
