// Call one tool. Read tools: GET with query parameters, or POST with a JSON
// body. Write tools: POST only. Same tools, same answers as the MCP endpoint.
import { requireApiKeyContext } from "@/lib/auth/api-key";
import { foreignOrigin, json, readJson } from "@/server/agent/http";
import { argsFromQuery, outcomeResponse } from "@/server/agent/rest";
import { callTool, findTool } from "@/server/agent/tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: Params) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  const { name } = await params;
  const t = findTool(name);
  if (!t) return json({ error: `No tool named "${name}". GET /api/v1/tools lists them.` }, 404);
  if (t.access === "write")
    return json({ error: `${name} changes data; call it with POST.` }, 405, { Allow: "POST" });
  const out = outcomeResponse(
    await callTool(ctx, ctx.access, name, argsFromQuery(t, new URL(request.url).searchParams)),
  );
  return json(out.body, out.status);
}

export async function POST(request: Request, { params }: Params) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  const { name } = await params;
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const out = outcomeResponse(await callTool(ctx, ctx.access, name, body.value ?? {}));
  return json(out.body, out.status);
}
