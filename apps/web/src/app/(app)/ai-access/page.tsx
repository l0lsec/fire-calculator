// AI access: let the user's own AI assistant (Claude, ChatGPT/Codex, any MCP
// client) work with their plan through their own subscription, so the app
// never pays for model usage. One question: "how do I connect my assistant?"
import { headers } from "next/headers";
import { ButtonForm } from "@/components/action-form";
import { Card, Disclaimer } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { dateText, dateTimeText } from "@/lib/format";
import { listKeys, MAX_KEYS } from "@/server/agent/keys";
import { TOOLS } from "@/server/agent/tools";
import { restoreKeyAction, revokeKeyAction } from "./actions";
import { CreateKey } from "./create-key";
import { SetupSnippets } from "./setup-snippets";

export const metadata = { title: "AI access | FIRE Planner" };

/**
 * Where the stdio bridge lives on this machine: the server runs from apps/web
 * (pnpm dev) or the repo root. String logic only; probing the filesystem here
 * would make Next trace the whole project into the server bundle.
 */
function bridgePath(): string {
  try {
    const root = process.cwd().replace(/[/\\]apps[/\\]web[/\\]?$/, "");
    if (root && root !== "/") return `${root}/scripts/mcp-stdio.mjs`;
  } catch {
    // No working directory (Workers).
  }
  return "/path/to/fire-calculator/scripts/mcp-stdio.mjs";
}

const CLIENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  codex: "Codex",
  "codex-mcp-client": "Codex",
};

export default async function AiAccessPage() {
  const ctx = await requireContext();
  const keys = await listKeys(ctx);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3100";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;
  const places = { baseUrl, mcpUrl: `${baseUrl}/api/mcp`, bridgePath: bridgePath() };
  const readTools = TOOLS.filter((t) => t.access === "read");
  const writeTools = TOOLS.filter((t) => t.access === "write");
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">AI access</h1>
        <p className="text-sm text-ink-3">
          Ask Claude, ChatGPT or Codex about your plan using the subscription you already pay for. The app
          never calls an AI service itself and nothing here can move money.
        </p>
      </div>

      <Card title="Create a key">
        <CreateKey places={places} />
      </Card>

      <Card title={keys.length ? `Your keys (${keys.length} of ${MAX_KEYS})` : "Your keys"}>
        {keys.length === 0 ? (
          <p className="text-sm text-ink-3">No keys yet. Create one above, then connect your assistant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="key-list">
            {keys.map((k) => {
              const expired = k.expiresAt !== null && k.expiresAt.getTime() <= now;
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  data-testid={`key-${k.id}`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <p className="font-medium text-ink">
                      {k.name}{" "}
                      <span className="font-normal text-ink-3">
                        · {k.access === "write" ? "can make changes" : "read only"}
                      </span>
                    </p>
                    <p className="text-xs text-ink-3">
                      <code>{k.prefix}...</code> · created {dateText(k.createdAt.toISOString())} ·{" "}
                      {expired ? (
                        <span className="text-warn">expired {dateText(k.expiresAt!.toISOString())}</span>
                      ) : k.expiresAt ? (
                        `works until ${dateText(k.expiresAt.toISOString())}`
                      ) : (
                        "never expires"
                      )}
                    </p>
                    <p className="text-xs text-ink-3">
                      {k.lastUsedAt
                        ? `Last used ${dateTimeText(k.lastUsedAt.toISOString())}${
                            k.lastClient ? ` by ${CLIENT_NAMES[k.lastClient] ?? k.lastClient}` : ""
                          }`
                        : "Not used yet"}
                    </p>
                  </div>
                  <ButtonForm
                    action={revokeKeyAction}
                    undo={restoreKeyAction}
                    label="Revoke"
                    pendingLabel="Revoking..."
                    variant="secondary"
                    hidden={{ id: k.id }}
                    testId={`revoke-${k.id}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Connect an assistant">
        <div className="flex flex-col gap-4">
          <SetupSnippets places={places} />
          <details className="text-sm text-ink-2">
            <summary className="flex min-h-10 cursor-pointer items-center font-medium text-accent pointer-coarse:min-h-11">
              Web apps and other ways to connect
            </summary>
            <div className="flex flex-col gap-2 pb-2">
              <p>
                The desktop and command-line apps above run on this Mac, so they reach the app at {baseUrl}.
                The web versions (claude.ai, chatgpt.com) run in the cloud: they need a public HTTPS address,
                such as a Cloudflare Tunnel to this Mac, and their connector setup must accept a bearer key. A
                Custom GPT Action can: import {baseUrl}/api/v1/openapi.json and choose API key, Bearer.
              </p>
              <p>
                Any other MCP client that speaks Streamable HTTP can use {places.mcpUrl} with the header{" "}
                <code>Authorization: Bearer fire_...</code>. Clients that only start local programs can use
                the bridge at <code className="break-all">{places.bridgePath}</code>.
              </p>
            </div>
          </details>
          <details className="text-sm text-ink-2">
            <summary className="flex min-h-10 cursor-pointer items-center font-medium text-accent pointer-coarse:min-h-11">
              What an assistant can see and do ({TOOLS.length} tools)
            </summary>
            <div className="grid gap-4 pb-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 font-medium text-ink">Every key</p>
                <ul className="flex flex-col gap-1">
                  {readTools.map((t) => (
                    <li key={t.name}>{t.title}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium text-ink">Keys that can make changes</p>
                <ul className="flex flex-col gap-1">
                  {writeTools.map((t) => (
                    <li key={t.name}>{t.title}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-3">
                  Changes go to what-if copies, never your baseline plan. Spending decisions and dismissed
                  alerts can be undone on their pages.
                </p>
              </div>
            </div>
          </details>
        </div>
      </Card>

      <Disclaimer />
    </div>
  );
}
