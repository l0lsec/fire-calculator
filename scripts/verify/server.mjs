// Build (when stale) and start the production Next server for HTTP-level gates.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fail, ROOT, run } from "./lib.mjs";

const WEB = join(ROOT, "apps/web");

function newest(dir) {
  let t = 0;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".open-next") continue;
    const p = join(dir, name);
    const s = statSync(p);
    t = Math.max(t, s.isDirectory() ? newest(p) : s.mtimeMs);
  }
  return t;
}

export function ensureBuilt() {
  const id = join(WEB, ".next/BUILD_ID");
  const srcTime = Math.max(
    newest(join(WEB, "src")),
    ...["packages/engine/src", "packages/db/src", "packages/plaid/src", "packages/spending/src"].map((p) =>
      newest(join(ROOT, p)),
    ),
  );
  if (existsSync(id) && statSync(id).mtimeMs > srcTime) return;
  run("pnpm", ["exec", "next", "build"], { cwd: WEB });
}

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

/** Starts `next start` and waits until it answers. Returns { url, stop }. */
export async function startServer(env = {}) {
  ensureBuilt();
  const port = await freePort();
  const child = spawn("pnpm", ["exec", "next", "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: WEB,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const append = (d) => {
    log += d;
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${url}/sign-in`, { redirect: "manual" });
      return {
        url,
        log: () => log,
        stop: () =>
          new Promise((r) => {
            child.once("exit", r);
            child.kill("SIGTERM");
          }),
      };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  child.kill("SIGKILL");
  fail(`next start did not come up:\n${log.slice(-2000)}`);
}

/** Every page and route handler path under src/app, with dynamic segments filled. */
export function discoverRoutes() {
  const app = join(WEB, "src/app");
  const pages = [];
  const apis = [];
  const walk = (dir, parts) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        const seg = /^\(.*\)$/.test(name)
          ? null
          : /^\[.*\]$/.test(name)
            ? "00000000-0000-4000-8000-000000000000"
            : name;
        walk(p, seg === null ? parts : [...parts, seg]);
      } else if (/^page\.tsx?$/.test(name)) pages.push(`/${parts.join("/")}`);
      else if (/^route\.tsx?$/.test(name)) apis.push(`/${parts.join("/")}`);
    }
  };
  walk(app, []);
  return { pages, apis };
}
