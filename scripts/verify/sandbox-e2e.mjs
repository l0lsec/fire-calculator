// Real-Sandbox end-to-end runner: opens a temporary ngrok tunnel to the local
// app so Plaid can deliver real webhooks, runs e2e/sandbox specs, and closes
// the tunnel. The tunnel exposes only the local app, whose routes require an
// MFA session (the webhook route requires a valid Plaid signature).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, fail, ROOT, run } from "./lib.mjs";
import { ensureBuilt } from "./server.mjs";

export const SANDBOX_PORT = 3197;

export function sandboxKeysPresent() {
  const env = readFileSync(join(ROOT, ".env"), "utf8");
  return (
    /^PLAID_CLIENT_ID=.+$/m.test(env) &&
    /^PLAID_SECRET=.+$/m.test(env) &&
    !/^PLAID_ENV=production$/m.test(env)
  );
}

async function openTunnel(port) {
  const child = spawn("ngrok", ["http", String(port), "--log", "stdout", "--log-format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ngrok did not start: ${buf.slice(-500)}`)), 20_000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try {
          const j = JSON.parse(line);
          if (j.url && String(j.url).startsWith("https://")) {
            clearTimeout(timer);
            resolve(j.url);
          }
        } catch {}
      }
    });
    child.on("exit", (c) => reject(new Error(`ngrok exited ${c}: ${buf.slice(-500)}`)));
  });
  return { url, close: () => child.kill("SIGTERM") };
}

export async function sandboxE2E(requireTitles) {
  assert(sandboxKeysPresent(), "needs PLAID_CLIENT_ID and PLAID_SECRET (sandbox) in .env");
  ensureBuilt();
  let tunnel;
  try {
    tunnel = await openTunnel(SANDBOX_PORT);
  } catch (e) {
    fail(`could not open an ngrok tunnel for Plaid webhooks: ${e.message}`);
  }
  try {
    const r = run(
      "pnpm",
      ["exec", "playwright", "test", "-c", "e2e/playwright.sandbox.config.ts", "--reporter=json"],
      { allowFail: true, quiet: true, env: { E2E_TUNNEL_URL: tunnel.url } },
    );
    const report = JSON.parse(r.out.slice(r.out.indexOf("{")));
    const results = [];
    const walk = (s) => {
      for (const c of s.suites ?? []) walk(c);
      for (const spec of s.specs ?? []) {
        const ok = spec.tests.every((t) => t.results.some((x) => x.status === "passed"));
        results.push({ title: spec.title, ok });
        if (!ok)
          for (const t of spec.tests)
            for (const x of t.results)
              for (const e of x.errors ?? [])
                console.error(`${spec.title}: ${(e.message ?? "").split("\n").slice(0, 8).join("\n")}`);
      }
    };
    for (const s of report.suites ?? []) walk(s);
    for (const title of requireTitles) {
      assert(
        results.some((x) => x.title === title && x.ok),
        `required sandbox e2e test did not pass: "${title}"`,
      );
    }
    console.log(`sandbox e2e: ${results.filter((x) => x.ok).length}/${results.length} passed`);
  } finally {
    tunnel.close();
  }
}
