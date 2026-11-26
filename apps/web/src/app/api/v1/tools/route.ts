// GET /api/v1/tools: the tools this AI access key may call, with their input schemas.
import { requireApiKeyContext } from "@/lib/auth/api-key";
import { foreignOrigin, json } from "@/server/agent/http";
import { baseUrl, toolIndex } from "@/server/agent/rest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  return json(toolIndex(ctx.access, baseUrl(request)));
}

export async function POST(request: Request) {
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  return json({ error: "POST to /api/v1/tools/<name> to call a tool." }, 405, { Allow: "GET" });
}
