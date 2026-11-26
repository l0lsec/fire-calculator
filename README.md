# FIRE Planner

A financial-independence planner that counts your debts, measures your real spending from your bank
accounts (through Plaid), and projects every FI level with dates: Coast, Lean, Barista, FI and Fat,
plus debt milestones.

- **Plan and gates**: `BUILD_PLAN.md` (what was built and how each piece is proven).
- **Verification record**: `docs/VERIFICATION.md` (generated from the gate ledgers).
- **Running and deploying**: `docs/RUNBOOK.md`. **Security**: `docs/SECURITY.md`.

## Quick start

```bash
pnpm install
pnpm db:up        # local Supabase on ports 583xx
pnpm db:migrate
pnpm dev          # http://127.0.0.1:3100
```

Sign up, enroll an authenticator app (required), then either enter accounts and spending by hand
on Plan and Accounts, or connect a bank on Connections once Plaid keys are in `.env`.

## Using it day to day (personal, local)

This is built to run on your own machine; nothing needs to be public.

- **Start**: Docker Desktop running, then `pnpm db:up` and `pnpm dev` (http://127.0.0.1:3100).
- **Bank data**: Plaid Sandbox keys give test data. For your real accounts, request Plaid's
  Trial plan (up to 10 live connections, no public app required), then put the production
  `PLAID_SECRET` in `.env` and set `PLAID_ENV=production`.
- **Freshness**: with no public URL Plaid cannot send webhooks, so the app refreshes any
  connection older than 12 hours when you open it; "Refresh now" and `pnpm sync` force one.
- **Backups**: `pnpm backup` writes a SQL dump to `backups/` (git-ignored). Never run
  `supabase stop --no-backup`: it deletes the local database volume.
- **AI assistants**: Accounts, AI access creates a key so Claude Code, Codex, Claude Desktop or any
  MCP client can read your plan on your own subscription (the app never pays for AI). See
  `docs/AI_ACCESS.md`.
- **Checks**: the test suites share the local stack but only ever create and remove
  `@example.test` users, so they never touch your data.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure planning math: debts, cash flows, projection, FI levels, withdrawal access, risk |
| `packages/spending` | Pure spending derivation from transactions (transfers, card payments, escrow) |
| `packages/plaid` | Plaid client, schemas, webhook verifier, and a faithful fake Plaid API for tests |
| `packages/db` | Drizzle schema, migrations, household-scoped repositories, token encryption |
| `apps/web` | Next.js app on Cloudflare Workers (OpenNext) |
| `e2e` | Playwright suites (fake Plaid, and real Plaid Sandbox) |
| `scripts/guards`, `scripts/verify` | Repository guards and gate scripts |

Estimates for education and planning, based on your assumptions. Not financial advice.

## License

MIT, see `LICENSE`. Historical market data in `packages/engine/data/` is derived from Robert
Shiller's public dataset; cite it if you share results. Plaid, Supabase and Cloudflare are
third-party services under their own terms.
