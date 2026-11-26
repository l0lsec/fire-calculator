// AI access: keys (hash-only storage, revoke, expiry, membership), the MCP
// protocol (negotiation, tool listing by access, calls, errors), the REST
// routes, household isolation, and the guarantee that AI writes never touch
// the baseline plan.
import { createHouseholdForUser, listAccounts, listScenarios, scopeFor } from "@fire/db";
import { createTestDb, type TestDb } from "@fire/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let t: TestDb;
vi.mock("../src/lib/db", () => ({ getDb: () => t.db }));

const { bearerKey, hashApiKey, newApiKey, requireApiKeyContext } = await import("../src/lib/auth/api-key");
const { createKey, listKeys, restoreKey, revokeKey } = await import("../src/server/agent/keys");
const { handleBody, handleMessage, LATEST_VERSION, listTools, RPC } = await import("../src/server/agent/mcp");
const { argsFromQuery, openApi } = await import("../src/server/agent/rest");
const { callTool, findTool, inputJsonSchema, TOOLS } = await import("../src/server/agent/tools");
const mcpRoute = await import("../src/app/api/mcp/route");
const toolRoute = await import("../src/app/api/v1/tools/[name]/route");
const { saveManualAccount } = await import("../src/server/accounts");
const { saveDebt } = await import("../src/server/debts");
const { saveContribution, saveIncome, savePerson, saveSpending } = await import("../src/server/profile");

type Ctx = { db: TestDb["db"]; scope: ReturnType<typeof scopeFor>; userId: string };

async function household(tag: string): Promise<Ctx> {
  const userId = crypto.randomUUID();
  const id = await createHouseholdForUser(t.db, userId, tag);
  const ctx = { db: t.db, scope: scopeFor(id), userId };
  await savePerson(ctx, { name: `Person ${tag}`, birth: "1990-06" });
  const [person] = await (await import("@fire/db")).listPeople(t.db, ctx.scope);
  await saveManualAccount(ctx, {
    name: `Brokerage ${tag}`,
    bucket: "taxable",
    balance: "150000",
    includeInFi: "on",
  });
  await saveDebt(ctx, {
    name: `Visa ${tag}`,
    kind: "credit_card",
    balance: "4000",
    apr: "22",
    minType: "card",
    cardFloor: "35",
    cardPct: "1",
  });
  await saveIncome(ctx, {
    personId: person!.id,
    name: "Salary",
    kind: "takeHome",
    monthly: "8000",
    growth: "raise",
    phase: "working",
  });
  await saveContribution(ctx, { name: "401(k)", bucket: "traditional", monthly: "1000" });
  await saveSpending(ctx, { source: "manual", annual: "48000", essential: "30000" });
  return ctx;
}

const req = (key: string | null, init: RequestInit & { url?: string } = {}) =>
  new Request(init.url ?? "http://127.0.0.1:3100/api/mcp", {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

async function makeKey(ctx: Ctx, access: "read" | "write", expires = "90") {
  const r = await createKey(ctx, { name: `${access} key`, access, expires });
  if (!r.ok || !r.data) throw new Error("key not created");
  return r.data;
}

let a: Ctx;
let b: Ctx;
beforeAll(async () => {
  t = await createTestDb();
  a = await household("A");
  b = await household("B");
});
afterAll(async () => t.close());

describe("AI access keys", () => {
  it("are high-entropy, stored only as a hash, and shown once", async () => {
    const k = await newApiKey();
    expect(k.secret).toMatch(/^fire_[A-Za-z0-9_-]{43}$/);
    expect(k.hash).toBe(await hashApiKey(k.secret));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await newApiKey()).secret).not.toBe(k.secret);

    const created = await makeKey(a, "read");
    const { rows } = await t.pg.query<{ token_hash: string }>("select * from fire.api_tokens where id = $1", [
      created.key.id,
    ]);
    expect(rows[0]?.token_hash).toBe(await hashApiKey(created.secret));
    expect(JSON.stringify(rows)).not.toContain(created.secret);
    expect(JSON.stringify(await listKeys(a))).not.toContain(created.secret);
    expect(created.key.prefix).toBe(created.secret.slice(0, 11));
  });

  it("validates the form and keeps a plain error", async () => {
    expect(await createKey(a, { name: " ", access: "read", expires: "90" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.stringMatching(/Name the key/) },
    });
    expect(await createKey(a, { name: "x", access: "admin", expires: "90" })).toMatchObject({ ok: false });
  });

  it("authenticate only a live, well-formed bearer key, and map to the key's household", async () => {
    const { secret, key } = await makeKey(a, "read");
    expect(bearerKey(req(secret))).toBe(secret);
    expect(bearerKey(req("fire_short"))).toBeNull();
    expect(await requireApiKeyContext(req(null))).toBeInstanceOf(Response);
    expect(((await requireApiKeyContext(req(null))) as Response).status).toBe(401);
    const other = await newApiKey();
    expect(((await requireApiKeyContext(req(other.secret))) as Response).status).toBe(401);

    const ctx = await requireApiKeyContext(req(secret), { client: "claude-code" });
    if (ctx instanceof Response) throw new Error("expected a context");
    expect(ctx.scope.householdId).toBe(a.scope.householdId);
    expect(ctx.access).toBe("read");
    expect((await listKeys(a)).find((x) => x.id === key.id)?.lastClient).toBe("claude-code");

    // Revoke: refused at once; Undo brings it back.
    expect(await revokeKey(a, key.id)).toMatchObject({ ok: true, data: { undo: { id: key.id } } });
    expect(((await requireApiKeyContext(req(secret))) as Response).status).toBe(401);
    expect((await listKeys(a)).some((x) => x.id === key.id)).toBe(false);
    expect(await restoreKey(a, key.id)).toMatchObject({ ok: true });
    expect(await requireApiKeyContext(req(secret))).not.toBeInstanceOf(Response);

    // Another household cannot revoke it.
    expect(await revokeKey(b, key.id)).toMatchObject({ ok: false });
  });

  it("stop working when expired or when their creator leaves the household", async () => {
    const exp = await makeKey(a, "read");
    await t.pg.query("update fire.api_tokens set expires_at = now() - interval '1 second' where id = $1", [
      exp.key.id,
    ]);
    expect(((await requireApiKeyContext(req(exp.secret))) as Response).status).toBe(401);

    const c = await household("C");
    const k = await makeKey(c, "write");
    expect(await requireApiKeyContext(req(k.secret))).not.toBeInstanceOf(Response);
    await t.pg.query("delete from fire.household_members where user_id = $1", [c.userId]);
    expect(((await requireApiKeyContext(req(k.secret))) as Response).status).toBe(401);
  });
});

describe("MCP protocol", () => {
  const session = (access: "read" | "write", ctx: Ctx = a) => ({ ctx, access });
  const call = (access: "read" | "write", name: string, args: unknown = {}, ctx: Ctx = a) =>
    handleMessage(session(access, ctx), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }) as Promise<{
      result?: {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
        content: { text: string }[];
      };
      error?: { code: number };
    }>;

  it("negotiates the protocol version and announces tools", async () => {
    const r = (await handleMessage(session("read"), {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    })) as { result: { protocolVersion: string; capabilities: { tools: unknown }; instructions: string } };
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.instructions).toMatch(/read-only/);
    const future = (await handleMessage(session("write"), {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" },
    })) as { result: { protocolVersion: string; instructions: string } };
    expect(future.result.protocolVersion).toBe(LATEST_VERSION);
    expect(future.result.instructions).not.toMatch(/read-only/);
  });

  it("answers notifications with nothing, ping with {}, unknown methods with -32601", async () => {
    expect(
      await handleMessage(session("read"), { jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
    expect(await handleMessage(session("read"), { jsonrpc: "2.0", id: 2, method: "ping" })).toMatchObject({
      result: {},
    });
    expect(await handleMessage(session("read"), { jsonrpc: "2.0", id: 3, method: "nope" })).toMatchObject({
      error: { code: RPC.methodNotFound },
    });
    expect(await handleMessage(session("read"), { hello: 1 })).toMatchObject({
      error: { code: RPC.invalidRequest },
    });
    const batch = await handleBody(session("read"), [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    expect(batch).toHaveLength(1);
  });

  it("lists only read tools for a read-only key, and every schema is an object", () => {
    const read = listTools("read").map((x) => x.name);
    const write = listTools("write").map((x) => x.name);
    expect(read).toContain("get_overview");
    expect(read).not.toContain("create_scenario");
    expect(write).toContain("create_scenario");
    expect(write.length).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(inputJsonSchema(tool).type, tool.name).toBe("object");
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
    expect(new Set(TOOLS.map((x) => x.name)).size).toBe(TOOLS.length);
  });

  it("runs every read tool on a real household", async () => {
    for (const tool of TOOLS.filter((x) => x.access === "read")) {
      const args =
        tool.name === "compare_scenarios"
          ? { scenarioIds: [(await listScenarios(t.db, a.scope))[0]!.id] }
          : tool.name === "invest_vs_prepay"
            ? {
                debtId: (await (await import("@fire/db")).listDebts(t.db, a.scope))[0]!.id,
                extraMonthly: 200,
              }
            : {};
      const r = await call("read", tool.name, args);
      expect(r.result?.isError, `${tool.name}: ${r.result?.content[0]?.text}`).toBeUndefined();
      expect(r.result?.structuredContent, tool.name).toBeDefined();
    }
    const overview = await call("read", "get_overview");
    const headline = overview.result!.structuredContent!.headline as { fiTarget: number; portfolio: number };
    expect(headline.fiTarget).toBeGreaterThan(48000 / 0.05);
    expect(headline.portfolio).toBeGreaterThanOrEqual(150000);
  });

  it("only ever sees its own household", async () => {
    const r = await call("read", "list_accounts", {}, a);
    const names = (r.result!.structuredContent!.items as { name: string }[]).map((x) => x.name);
    expect(names).toContain("Brokerage A");
    expect(names).not.toContain("Brokerage B");
    const debtB = (await (await import("@fire/db")).listDebts(t.db, b.scope))[0]!;
    const cross = await call("read", "invest_vs_prepay", { debtId: debtB.id, extraMonthly: 100 }, a);
    expect(cross.result?.isError).toBe(true);
  });

  it("refuses write tools on a read-only key, bad arguments and unknown tools in words", async () => {
    const w = await call("read", "create_scenario", { name: "x" });
    expect(w.result?.isError).toBe(true);
    expect(w.result?.content[0]?.text).toMatch(/read-only/);
    const bad = await call("read", "list_transactions", { from: "last week" });
    expect(bad.result?.isError).toBe(true);
    expect(bad.result?.content[0]?.text).toMatch(/YYYY-MM-DD/);
    expect(await call("read", "no_such_tool")).toMatchObject({ error: { code: RPC.invalidParams } });
  });

  it("writes go to a what-if copy and never change the baseline", async () => {
    const before = await listScenarios(t.db, a.scope);
    const baseline = before.find((s) => s.isBaseline)!;
    const refused = await call("write", "add_scenario_adjustment", {
      scenarioId: baseline.id,
      label: "Travel",
      annualAmount: 12000,
    });
    expect(refused.result?.isError).toBe(true);
    expect(refused.result?.content[0]?.text).toMatch(/baseline/);

    const made = await call("write", "create_scenario", { name: "Travel more" });
    const scenarioId = made.result!.structuredContent!.scenarioId as string;
    const added = await call("write", "add_scenario_adjustment", {
      scenarioId,
      label: "Travel",
      annualAmount: 12000,
      fromAge: 55,
      untilAge: 70,
    });
    expect(added.result?.isError).toBeUndefined();
    const after = await listScenarios(t.db, a.scope);
    expect(after.find((s) => s.id === baseline.id)?.retirementAdjustments).toEqual(
      baseline.retirementAdjustments,
    );
    expect(JSON.stringify(after.find((s) => s.id === scenarioId)?.retirementAdjustments)).toContain("Travel");

    const cmp = await call("read", "compare_scenarios", { scenarioIds: [baseline.id, scenarioId] });
    expect(cmp.result?.isError).toBeUndefined();

    expect(
      (await call("write", "set_budget", { category: "FOOD_AND_DRINK", monthlyAmount: 600 })).result?.isError,
    ).toBeUndefined();
    expect(
      (await call("write", "set_budget", { category: "food", monthlyAmount: 600 })).result?.isError,
    ).toBe(true);
  });
});

describe("HTTP routes", () => {
  it("MCP: 401 without a key, 403 cross-site, 202 for notifications, JSON for requests", async () => {
    const { secret } = await makeKey(a, "read");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await mcpRoute.POST(req(null, { body }))).status).toBe(401);
    expect(
      (await mcpRoute.POST(req(secret, { body, headers: { origin: "https://evil.example" } }))).status,
    ).toBe(403);
    expect(
      (
        await mcpRoute.POST(
          req(secret, { body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }),
        )
      ).status,
    ).toBe(202);
    const res = await mcpRoute.POST(req(secret, { body }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as { result: { tools: unknown[] } };
    expect(json.result.tools.length).toBe(listTools("read").length);
    const parse = await mcpRoute.POST(req(secret, { body: "{not json" }));
    expect(parse.status).toBe(400);
    expect((await mcpRoute.GET(req(secret, { method: "GET" }))).status).toBe(405);
    expect((await mcpRoute.GET(req(null, { method: "GET" }))).status).toBe(401);
  });

  it("REST: GET read tools with query args, POST with JSON, write tools need a write key", async () => {
    const read = await makeKey(a, "read");
    const write = await makeKey(a, "write");
    const url = (name: string, q = "") => `http://127.0.0.1:3100/api/v1/tools/${name}${q}`;
    const p = (name: string) => ({ params: Promise.resolve({ name }) });

    const g = await toolRoute.GET(
      req(read.secret, { method: "GET", url: url("list_transactions", "?limit=5") }),
      p("list_transactions"),
    );
    expect(g.status).toBe(200);
    expect(((await g.json()) as { result: { transactions: unknown[] } }).result.transactions).toBeDefined();

    const forbidden = await toolRoute.POST(
      req(read.secret, { url: url("create_scenario"), body: JSON.stringify({ name: "x" }) }),
      p("create_scenario"),
    );
    expect(forbidden.status).toBe(403);
    const created = await toolRoute.POST(
      req(write.secret, { url: url("create_scenario"), body: JSON.stringify({ name: "From REST" }) }),
      p("create_scenario"),
    );
    expect(created.status).toBe(200);
    expect(
      (
        await toolRoute.GET(
          req(write.secret, { method: "GET", url: url("create_scenario") }),
          p("create_scenario"),
        )
      ).status,
    ).toBe(405);
    expect(
      (await toolRoute.GET(req(read.secret, { method: "GET", url: url("nope") }), p("nope"))).status,
    ).toBe(404);
    const invalid = await toolRoute.POST(
      req(read.secret, { url: url("list_transactions"), body: JSON.stringify({ limit: 0 }) }),
      p("list_transactions"),
    );
    expect(invalid.status).toBe(400);
  });

  it("coerces query strings by schema and documents every tool in OpenAPI", () => {
    const tx = findTool("list_transactions")!;
    expect(argsFromQuery(tx, new URLSearchParams("limit=5&search=coffee&from=2026-01-01"))).toEqual({
      limit: 5,
      search: "coffee",
      from: "2026-01-01",
    });
    const cmp = findTool("compare_scenarios")!;
    expect(argsFromQuery(cmp, new URLSearchParams("scenarioIds=a,b"))).toEqual({ scenarioIds: ["a", "b"] });
    const doc = openApi("read", "http://127.0.0.1:3100") as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toHaveLength(listTools("read").length);
    expect(Object.keys(openApi("write", "http://x").paths)).toHaveLength(TOOLS.length);
  });

  it("callTool never throws, even for odd input", async () => {
    expect(await callTool(a, "read", "list_accounts", null)).toMatchObject({ ok: true });
    expect(await callTool(a, "read", "list_accounts", "x")).toMatchObject({ ok: false, kind: "invalid" });
    expect((await listAccounts(t.db, a.scope)).length).toBeGreaterThan(0);
  });
});

describe("stdio bridge (scripts/mcp-stdio.mjs)", () => {
  it("carries a full MCP session from stdin to the HTTP endpoint and back", async () => {
    const { createServer } = await import("node:http");
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const { secret } = await makeKey(a, "read");

    // A real HTTP server in front of the real route handler.
    const server = createServer(async (inReq, res) => {
      const chunks: Buffer[] = [];
      for await (const c of inReq) chunks.push(c as Buffer);
      const r = await mcpRoute.POST(
        new Request(`http://127.0.0.1${inReq.url}`, {
          method: "POST",
          headers: inReq.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        }),
      );
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;

    const bridge = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../../scripts/mcp-stdio.mjs", import.meta.url))],
      {
        env: { ...process.env, FIRE_URL: `http://127.0.0.1:${port}`, FIRE_API_KEY: secret },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    bridge.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i = buf.indexOf("\n");
      while (i >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        i = buf.indexOf("\n");
      }
    });
    const send = (m: unknown) => bridge.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bridge-test", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_accounts", arguments: {} } });
    bridge.stdin.end();
    await new Promise((ok) => bridge.on("exit", ok));
    server.close();

    // Three answers (the notification gets none), in order.
    expect(lines.map((l) => l.id)).toEqual([1, 2, 3]);
    expect((lines[0] as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      "fire-planner",
    );
    expect((lines[1] as { result: { tools: unknown[] } }).result.tools.length).toBe(listTools("read").length);
    expect(JSON.stringify(lines[2])).toContain("Brokerage A");
    expect((await listKeys(a)).some((k) => k.lastClient === "bridge-test")).toBe(true);
  });

  it("answers every request with a JSON-RPC error when the key is wrong or the app is down", async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const bridge = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../../scripts/mcp-stdio.mjs", import.meta.url))],
      {
        env: { ...process.env, FIRE_URL: "http://127.0.0.1:9", FIRE_API_KEY: "nope" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let out = "";
    bridge.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
    bridge.stdin.end();
    await new Promise((ok) => bridge.on("exit", ok));
    const msg = JSON.parse(out.trim()) as { id: number; error: { message: string } };
    expect(msg.id).toBe(7);
    expect(msg.error.message).toMatch(/Cannot reach FIRE Planner/);
  });
});
