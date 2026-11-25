// Helpers for gate scripts. A gate script asserts an outcome and prints its
// success-only token as the LAST thing it does; any failed assertion exits 1
// before the token can be printed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname;

export function fail(message) {
  console.error(`GATE FAIL: ${message}`);
  process.exit(1);
}

export function assert(cond, message) {
  if (!cond) fail(message);
}

/** Run a command from the repo root; fail the gate on a nonzero exit. */
export function run(cmd, args, { cwd = ROOT, env = {}, quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!quiet) console.log(`$ ${cmd} ${args.join(" ")}  (exit ${r.status})`);
  if (r.status !== 0 && !allowFail) {
    console.error(out.split("\n").slice(-60).join("\n"));
    fail(`${cmd} ${args.join(" ")} exited ${r.status}`);
  }
  return { code: r.status, out };
}

/**
 * Run vitest on the given files and require: zero failures, at least one pass,
 * and that every name in `requireTests` matched at least one PASSED test (so a
 * renamed or skipped test cannot silently satisfy the gate).
 */
export function vitest(files, requireTests = [], { env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fire-gate-"));
  const outFile = join(dir, "report.json");
  const r = run("pnpm", ["exec", "vitest", "run", ...files, "--reporter=json", `--outputFile=${outFile}`], {
    env,
    allowFail: true,
    quiet: true,
  });
  let report;
  try {
    report = JSON.parse(readFileSync(outFile, "utf8"));
  } catch {
    console.error(r.out.split("\n").slice(-60).join("\n"));
    fail(`vitest produced no report for ${files.join(" ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const results = report.testResults.flatMap((f) => f.assertionResults);
  const failed = results.filter((t) => t.status === "failed");
  const passed = results.filter((t) => t.status === "passed");
  for (const t of failed) {
    console.error(`FAILED: ${t.fullName}`);
    for (const m of t.failureMessages ?? []) console.error(m.split("\n").slice(0, 12).join("\n"));
  }
  for (const f of report.testResults) {
    if (f.status === "failed" && f.assertionResults.length === 0)
      console.error(`SUITE ERROR ${f.name}: ${f.message}`);
  }
  assert(r.code === 0 && failed.length === 0, `vitest failures in ${files.join(" ")}`);
  assert(passed.length > 0, `no tests passed in ${files.join(" ")}`);
  for (const name of requireTests) {
    assert(
      passed.some((t) => t.fullName.includes(name)),
      `required test did not pass (missing, skipped or renamed): "${name}"`,
    );
  }
  console.log(`vitest: ${passed.length} passed, 0 failed (${files.join(", ")})`);
  return passed;
}

export function pass(token) {
  console.log(token);
  process.exit(0);
}
