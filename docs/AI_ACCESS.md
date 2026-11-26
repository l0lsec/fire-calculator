# AI access: bring your own assistant

FIRE Planner never calls an AI model and has no AI bill. Instead it exposes your plan to the assistant
you already pay for (Claude Pro or Max, ChatGPT Plus or Pro through Codex, or any MCP client), which
does the thinking on its own subscription. Two doors lead to the same set of tools:

| Door | Address | For |
|---|---|---|
| MCP (Streamable HTTP) | `POST /api/mcp` | Claude Code, Codex, Claude Desktop (through the stdio bridge), any MCP client |
| REST | `GET /api/v1/tools`, `GET` or `POST /api/v1/tools/<name>`, `GET /api/v1/openapi.json` | Scripts, GPT Actions, anything that speaks HTTP or OpenAPI |

Both take an **AI access key** as `Authorization: Bearer fire_...`.

## Get a key

Accounts, then the **AI access** tab. Name the key, pick what it can do (read only is the default),
pick when it stops working (90 days by default), and press **Create key**. The key is shown once,
together with the setup for each assistant with the key already filled in.

## Connect

With the app running locally at `http://127.0.0.1:3100`:

**Claude Code**

```bash
claude mcp add --transport http --scope user fire-planner http://127.0.0.1:3100/api/mcp --header "Authorization: Bearer fire_..."
```

**Codex** (`~/.codex/config.toml`, key in your shell profile as `FIRE_API_KEY`)

```toml
[mcp_servers.fire_planner]
url = "http://127.0.0.1:3100/api/mcp"
bearer_token_env_var = "FIRE_API_KEY"
```

**Claude Desktop** (`claude_desktop_config.json`; Desktop starts local programs, so it goes through
`scripts/mcp-stdio.mjs`, a dependency-free bridge from stdio to the HTTP endpoint)

```json
{
  "mcpServers": {
    "fire-planner": {
      "command": "node",
      "args": ["/absolute/path/to/fire-calculator/scripts/mcp-stdio.mjs"],
      "env": { "FIRE_URL": "http://127.0.0.1:3100", "FIRE_API_KEY": "fire_..." }
    }
  }
}
```

**curl**

```bash
curl -H "Authorization: Bearer fire_..." http://127.0.0.1:3100/api/v1/tools/get_overview
```

**Web apps (claude.ai, chatgpt.com).** They run in the cloud, so they need a public HTTPS address
for the app (a Cloudflare Tunnel to this Mac, or the Workers deployment). A Custom GPT Action works
with that address: import `/api/v1/openapi.json` and choose API key, Bearer. The claude.ai and
ChatGPT connector screens expect OAuth, which this app does not offer yet; use the desktop and
command-line apps above until it does.

## Tools

Every key can read:

| Tool | What it returns |
|---|---|
| `get_overview` | FI number, FI date and age, portfolio, net worth, savings rate, every FI level with target and date, issues, warnings, a yearly trajectory |
| `list_accounts` | Asset accounts with balance, tax bucket, counts toward FI, source |
| `list_debts` | Debts with balance, APR (null when unknown) and its source |
| `get_spending` | Measured yearly spending by category, month and account, plus the spending-review queue |
| `list_transactions` | Transactions between two dates, with text and category filters |
| `get_budgets_and_bills` | Budgets against this month, subscriptions, bills, what is due soon, open alerts |
| `list_scenarios` | Baseline and what-ifs with their assumptions |
| `compare_scenarios` | Up to 4 scenarios side by side, including Monte Carlo and historical success |
| `invest_vs_prepay` | Whether extra monthly dollars reach FI sooner prepaying a debt or invested |
| `get_net_worth_history` | Weekly net worth from balance snapshots |
| `get_household_profile` | The app's export (people, income, contributions, accounts, debts, scenarios), without transactions |

Keys made with **Read and make changes** can also:

| Tool | Change |
|---|---|
| `create_scenario` | Copy the baseline (or another scenario) into a new what-if |
| `add_scenario_adjustment` | Add a retirement spending change to a what-if; the baseline is refused |
| `set_budget` | Set or clear one category's monthly budget |
| `set_debt_rate` | Set a debt's APR |
| `review_transaction` | Answer a spending-review question (undo on the Spending page) |
| `dismiss_alert` | Dismiss an alert (bring it back on Alerts) |

Money is in dollars, dates `YYYY-MM-DD`, rates in percent. The tools live in
`apps/web/src/server/agent/tools.ts`; MCP and REST both serve that one list, so they cannot drift.

## Security

- A key can only be created from a signed-in session with the second factor (AAL2), so it carries
  that factor. The middleware lets `/api/mcp` and `/api/v1/` past the session check; every handler
  then calls `requireApiKeyContext()`, which is the only way those routes get a household scope.
- The key is 32 random bytes. Only its SHA-256 is stored (`fire.api_tokens`), the list shows an
  11-character prefix, and the secret is never logged or shown again.
- A key stops working when revoked, when it expires, or when its creator leaves the household.
  Revoking is immediate; Undo restores it within 10 minutes. "Delete everything" removes all keys.
- Read-only keys do not even see the write tools. Write tools never change the baseline plan,
  never delete stored data, and cannot move money (the app has no payment code).
- 120 requests a minute per key. Requests with a foreign `Origin` header are refused, so a web page
  cannot reach a local server through your browser (DNS rebinding).
- What an assistant reads goes to that assistant's provider under your subscription's terms. Use a
  read-only key unless you want it to make changes, and revoke keys you no longer use.

Proof: `apps/web/test/ai-access.test.ts` (keys, protocol, isolation, routes, the bridge as a real
process) and `e2e/specs/ai-access.spec.ts` (the page, then MCP and REST with only the key).
