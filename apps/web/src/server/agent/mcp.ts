// A small, stateless Model Context Protocol server over Streamable HTTP
// (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
// Every POST carries one JSON-RPC message (or a batch) and gets plain JSON
// back; there are no server-initiated messages, so no SSE stream or session id
// is needed. Supports initialize, ping, tools/list and tools/call.
import { callTool, inputJsonSchema, type ToolAccess, type ToolCtx, toolsFor } from "./tools";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];
export const SERVER_INFO = { name: "fire-planner", title: "FIRE Planner", version: "1.0.0" } as const;

export const INSTRUCTIONS = `FIRE Planner is the user's own financial-independence planner. It measures spending from their bank accounts and projects when they reach each FI level (Coast, Lean, Barista, FI, Fat) and become debt-free.

Start with get_overview for the headline, then drill into list_accounts, list_debts, get_spending, list_transactions, get_budgets_and_bills or list_scenarios. Money is in US dollars, dates are YYYY-MM-DD, rates are percents.

To explore a what-if, call create_scenario (a copy of the baseline), change the copy with add_scenario_adjustment, and compare with compare_scenarios. The baseline plan cannot be changed through this connection, and nothing here can move money.

Results are estimates based on the user's own assumptions, for education and planning; they are not financial advice. Say so when you give a recommendation.`;

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string; data?: unknown } };

export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const err = (id: Id, code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });

function isRequest(m: unknown): m is RpcRequest {
  if (!m || typeof m !== "object") return false;
  const r = m as Record<string, unknown>;
  return r.jsonrpc === "2.0" && typeof r.method === "string";
}

const isWrite = (access: ToolAccess) => access === "write";

export function listTools(access: ToolAccess) {
  return toolsFor(access).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputJsonSchema(t),
    annotations: {
      title: t.title,
      readOnlyHint: t.access === "read",
      destructiveHint: false,
      idempotentHint: t.access === "read",
      openWorldHint: false,
    },
  }));
}

export interface McpSession {
  ctx: ToolCtx;
  access: ToolAccess;
}

/** Handle one message. Notifications (no id) return null: the HTTP layer answers 202. */
export async function handleMessage(session: McpSession, message: unknown): Promise<RpcResponse | null> {
  if (!isRequest(message)) {
    const id = (message as { id?: Id } | null)?.id ?? null;
    // A response or garbage from the client: nothing to answer unless it had an id.
    if (message && typeof message === "object" && ("result" in message || "error" in message)) return null;
    return err(id, RPC.invalidRequest, "Not a JSON-RPC 2.0 request");
  }
  const { id, method, params = {} } = message;
  if (id === undefined) return null; // notification, e.g. notifications/initialized

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : LATEST_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          INSTRUCTIONS +
          (isWrite(session.access)
            ? ""
            : "\n\nThis key is read-only: the tools that make changes are not available."),
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listTools(session.access) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const out = await callTool(session.ctx, session.access, name, params.arguments ?? {});
      if (!out.ok && out.kind === "unknown-tool") return err(id, RPC.invalidParams, out.message);
      // Tool-level failures go back as results with isError so the model can read and fix them.
      if (!out.ok) return ok(id, { content: [{ type: "text", text: out.message }], isError: true });
      const structured =
        out.result && typeof out.result === "object" && !Array.isArray(out.result)
          ? (out.result as Record<string, unknown>)
          : { items: out.result };
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(out.result, null, 2) }],
        structuredContent: structured,
      });
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return err(id, RPC.methodNotFound, `Method not found: ${method}`);
  }
}

/** Handle a POST body: one message or a batch. Returns null when nothing needs answering. */
export async function handleBody(
  session: McpSession,
  body: unknown,
): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return err(null, RPC.invalidRequest, "Empty batch");
    const out: RpcResponse[] = [];
    for (const m of body) {
      const r = await handleMessage(session, m);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return handleMessage(session, body);
}

/** The client name an initialize request announces, for the key's "last used by". */
export function clientNameOf(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  if (!isRequest(first) || first.method !== "initialize") return null;
  const info = first.params?.clientInfo as { name?: unknown; version?: unknown } | undefined;
  return typeof info?.name === "string" ? info.name : null;
}
