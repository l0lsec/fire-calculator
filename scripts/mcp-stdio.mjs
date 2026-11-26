#!/usr/bin/env node
// A stdio-to-HTTP bridge for MCP clients that only launch local commands
// (Claude Desktop's claude_desktop_config.json, and others). It reads one
// JSON-RPC message per line on stdin, POSTs it to FIRE Planner's /api/mcp with
// the AI access key, and writes each answer as one line on stdout. No
// dependencies: plain Node 18+.
//
//   FIRE_API_KEY=fire_...  FIRE_URL=http://127.0.0.1:3100  node scripts/mcp-stdio.mjs
import { createInterface } from "node:readline";

const base = (process.env.FIRE_URL || "http://127.0.0.1:3100").replace(/\/+$/, "");
const key = process.env.FIRE_API_KEY || "";
const endpoint = `${base}/api/mcp`;

const say = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (text) => process.stderr.write(`[fire-planner mcp] ${text}\n`);

if (!/^fire_[A-Za-z0-9_-]{43}$/.test(key))
  log("FIRE_API_KEY is missing or malformed; create a key on the app's AI access page.");

async function forward(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    say({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const ids = (Array.isArray(msg) ? msg : [msg]).map((m) => m?.id).filter((id) => id !== undefined);
  const fail = (message) => {
    for (const id of ids) say({ jsonrpc: "2.0", id, error: { code: -32603, message } });
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${key}`,
      },
      body: line,
    });
    if (res.status === 202) return;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (body && (body.jsonrpc || Array.isArray(body))) {
      for (const m of Array.isArray(body) ? body : [body]) say(m);
      return;
    }
    fail(body?.error || `FIRE Planner answered ${res.status}`);
  } catch (e) {
    fail(`Cannot reach FIRE Planner at ${base}. Is it running (pnpm dev)? ${e?.cause?.code ?? ""}`.trim());
  }
}

// Answer in order: a client may pipeline requests.
let chain = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(() => forward(line));
});
rl.on("close", () => {
  chain.then(() => process.exit(0));
});
