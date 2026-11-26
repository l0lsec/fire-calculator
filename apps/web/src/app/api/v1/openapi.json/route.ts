// OpenAPI 3.1 for the tools this AI access key may call (GPT Actions import it).
import { requireApiKeyContext } from "@/lib/auth/api-key";
import { foreignOrigin, json } from "@/server/agent/http";
import { baseUrl, openApi } from "@/server/agent/rest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (foreignOrigin(request)) return json({ error: "Cross-site requests are not allowed." }, 403);
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  return json(openApi(ctx.access, baseUrl(request)));
}

export async function POST(request: Request) {
  const ctx = await requireApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  return json({ error: "GET this document." }, 405, { Allow: "GET" });
}
