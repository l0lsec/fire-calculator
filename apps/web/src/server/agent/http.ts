import "server-only";
// HTTP plumbing shared by the AI endpoints: origin checks, body limits, and
// JSON answers that are never cached.

export const MAX_BODY = 256 * 1024;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * MCP clients and API scripts send no Origin header. A browser does, and a page
 * on another site must not reach a local server through the user's browser
 * (DNS rebinding), so a foreign Origin is refused.
 */
export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin === "null";
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, status: 413, error: "Request body is too large." };
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Request body is not valid JSON." };
  }
}
