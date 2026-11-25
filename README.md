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
