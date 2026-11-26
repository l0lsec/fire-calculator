"use client";
// How to connect each assistant, with the address (and, right after creating
// one, the key) already filled in so nothing has to be carried by hand.
import { useState } from "react";
import { Button } from "@/components/ui";

export interface SnippetPlaces {
  mcpUrl: string;
  baseUrl: string;
  bridgePath: string;
}

const PLACEHOLDER = "fire_YOUR_KEY";

export function snippets(p: SnippetPlaces, key = PLACEHOLDER) {
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      where: "Run once in a terminal. Uses your Claude subscription.",
      code: `claude mcp add --transport http --scope user fire-planner ${p.mcpUrl} --header "Authorization: Bearer ${key}"`,
    },
    {
      id: "claude-desktop",
      title: "Claude Desktop",
      where: "Settings, Developer, Edit Config: add this to claude_desktop_config.json, then restart Claude.",
      code: JSON.stringify(
        {
          mcpServers: {
            "fire-planner": {
              command: "node",
              args: [p.bridgePath],
              env: { FIRE_URL: p.baseUrl, FIRE_API_KEY: key },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "codex",
      title: "Codex (CLI and IDE)",
      where: "Add to ~/.codex/config.toml, and put the key in your shell profile. Uses your ChatGPT plan.",
      code: `[mcp_servers.fire_planner]\nurl = "${p.mcpUrl}"\nbearer_token_env_var = "FIRE_API_KEY"\n\n# in ~/.zshrc\nexport FIRE_API_KEY="${key}"`,
    },
    {
      id: "rest",
      title: "Any script (REST)",
      where:
        "Every tool is also plain HTTP. GET /api/v1/tools lists them; /api/v1/openapi.json describes them.",
      code: `curl -H "Authorization: Bearer ${key}" ${p.baseUrl}/api/v1/tools/get_overview`,
    },
  ];
}

export function CopyBlock({
  code,
  label = "Copy",
  testId,
}: {
  code: string;
  label?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <pre
        className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg p-3 text-xs"
        data-testid={testId}
      >
        {code}
      </pre>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : label}
        </Button>
        <span aria-live="polite" className="text-xs text-ink-3">
          {copied ? "On your clipboard." : ""}
        </span>
      </div>
    </div>
  );
}

export function SetupSnippets({ places, secret }: { places: SnippetPlaces; secret?: string }) {
  const list = snippets(places, secret);
  const [open, setOpen] = useState(list[0]!.id);
  const current = list.find((s) => s.id === open) ?? list[0]!;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Assistant" className="flex flex-wrap gap-1 border-b border-line">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === open}
            onClick={() => setOpen(s.id)}
            className={`-mb-px flex min-h-10 items-center border-b-2 px-3 text-sm pointer-coarse:min-h-11 ${
              s.id === open
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">{current.where}</p>
        <CopyBlock code={current.code} label="Copy setup" testId={`snippet-${current.id}`} />
        {secret ? null : (
          <p className="text-xs text-ink-3">
            Replace {PLACEHOLDER} with your key. Create one above and this fills in by itself.
          </p>
        )}
      </div>
    </div>
  );
}
