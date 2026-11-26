// The REST face of the tool registry: the same tools as MCP, as plain HTTP for
// scripts, GPT Actions and anything that speaks OpenAPI.
import { type CallOutcome, inputJsonSchema, type Tool, type ToolAccess, toolsFor } from "./tools";

const STATUS: Record<Exclude<CallOutcome, { ok: true }>["kind"], number> = {
  "unknown-tool": 404,
  forbidden: 403,
  invalid: 400,
  refused: 422,
  failed: 500,
};

export function outcomeResponse(out: CallOutcome): { status: number; body: unknown } {
  return out.ok
    ? { status: 200, body: { result: out.result } }
    : { status: STATUS[out.kind], body: { error: out.message } };
}

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; anyOf?: JsonSchema[] };

const typesOf = (s: JsonSchema | undefined): string[] => {
  if (!s) return [];
  const own = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  return [...own, ...(s.anyOf ?? []).flatMap(typesOf)];
};

/** Query-string values to typed tool arguments, guided by the tool's JSON Schema. */
export function argsFromQuery(t: Tool, params: URLSearchParams): Record<string, unknown> {
  const props = (inputJsonSchema(t) as JsonSchema).properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    const types = typesOf(props[key]);
    if (types.includes("array"))
      out[key] = raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    else if (
      (types.includes("number") || types.includes("integer")) &&
      raw.trim() !== "" &&
      Number.isFinite(Number(raw))
    )
      out[key] = Number(raw);
    else if (types.includes("boolean") && (raw === "true" || raw === "false")) out[key] = raw === "true";
    else if (types.includes("null") && raw === "null") out[key] = null;
    else out[key] = raw;
  }
  return out;
}

export function toolIndex(access: ToolAccess, base: string) {
  return {
    name: "FIRE Planner API",
    access,
    docs: `${base}/api/v1/openapi.json`,
    mcp: `${base}/api/mcp`,
    tools: toolsFor(access).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      access: t.access,
      call:
        t.access === "read"
          ? `GET or POST ${base}/api/v1/tools/${t.name}`
          : `POST ${base}/api/v1/tools/${t.name}`,
      inputSchema: inputJsonSchema(t),
    })),
  };
}

/** OpenAPI 3.1 for every tool this key may call (for ChatGPT GPT Actions and similar). */
export function openApi(access: ToolAccess, base: string) {
  const paths: Record<string, unknown> = {};
  for (const t of toolsFor(access)) {
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        "x-openai-isConsequential": t.access === "write",
        requestBody: { required: false, content: { "application/json": { schema: inputJsonSchema(t) } } },
        responses: {
          "200": {
            description: "The tool's result",
            content: { "application/json": { schema: { type: "object", properties: { result: {} } } } },
          },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "422": { $ref: "#/components/responses/Error" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "FIRE Planner",
      version: "1.0.0",
      description:
        "Read a household's FI plan, spending and debts, and explore what-if scenarios. Dollars, YYYY-MM-DD dates, percents. Estimates for planning, not financial advice.",
    },
    servers: [{ url: base }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An AI access key (fire_...)" },
      },
      responses: {
        Error: {
          description: "What went wrong, in words the caller can act on",
          content: {
            "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } },
          },
        },
      },
    },
    paths,
  };
}

/** The public base URL as the caller reached it (works behind a tunnel too). */
export function baseUrl(request: Request): string {
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? u.host;
  return `${proto}://${host}`;
}
