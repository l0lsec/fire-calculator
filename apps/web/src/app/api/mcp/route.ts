// The MCP endpoint (Streamable HTTP, stateless). AI assistants connect here
// with an AI access key: Claude Code, Codex, Claude Desktop (through
// scripts/mcp-stdio.mjs), or any MCP client that can send a bearer header.
// Public to the middleware's session check; requireApiKeyContext() is the gate.
import { requireApiKeyContext } from "@/lib/auth/api-key";
import { foreignOrigin, json, readJson } from "@/server/agent/http";
import { clientNameOf, handleBody, RPC } from "@/server/agent/mcp";

export const dynamic = "force-dynamic";

async function gate(request: Request, client?: string | null) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  return requireApiKeyContext(request, { client: client ?? null });
}

export async function POST(request: Request) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const body = await readJson(request);
  const ctx = await requireApiKeyContext(request, { client: body.ok ? clientNameOf(body.value) : null });
  if (ctx instanceof Response) return ctx;
  if (!body.ok)
    return json({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: body.error } }, body.status);
  const out = await handleBody({ ctx, access: ctx.access }, body.value);
  if (out === null) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  return json(out);
}

// No server-to-client stream and no sessions: GET and DELETE are not offered.
export async function GET(request: Request) {
  const ctx = await gate(request);
  if (ctx instanceof Response) return ctx;
  return json({ error: "This MCP server answers POST only." }, 405, { Allow: "POST" });
}

export async function DELETE(request: Request) {
  const ctx = await gate(request);
  if (ctx instanceof Response) return ctx;
  return json({ error: "This MCP server keeps no sessions." }, 405, { Allow: "POST" });
}
