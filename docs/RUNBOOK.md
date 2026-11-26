# Runbook

How to run FIRE Planner locally, deploy it, and operate it. Security background is in
`docs/SECURITY.md`; the build plan and gates are in `BUILD_PLAN.md`.

## Local development

1. `pnpm install`
2. `pnpm db:up` starts the local Supabase stack on ports 583xx (auth, Postgres, REST).
3. `pnpm db:migrate` applies the Drizzle migrations to it.
4. Copy `.env.example` to `.env` if you have not; the local stack's URL and anon key come from
   `supabase status -o env`. Generate `TOKEN_ENCRYPTION_KEYS` and `CRON_SECRET` as the example shows.
5. Plaid Sandbox: put the sandbox `PLAID_CLIENT_ID` and `PLAID_SECRET` in `.env`
   (dashboard.plaid.com, Developers, Keys). Without them the app runs in manual mode.
6. `pnpm dev` serves the app on http://127.0.0.1:3100.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm guards`, `pnpm e2e` (needs the local
stack; uses a fake Plaid API), and the gate ledgers under `.unlazy/fire-v1/gates/`.

## Personal local use with real banks

1. In the Plaid dashboard, request the **Trial plan** (US and Canada teams created after
   2026-04-15: up to 10 live Items, auto-approved for most developers). Plaid may ask you to
   complete its profile steps; that is between you and Plaid.
2. Put the production secret in `.env` as `PLAID_SECRET` and set `PLAID_ENV=production`.
   Keep `PLAID_WEBHOOK_URL` empty: without a public URL, Plaid cannot deliver webhooks.
3. Restart `pnpm dev`, connect your banks on Connections, review Spending, and spot-check
   three balances against your bank.
4. Freshness without webhooks: the app re-syncs connections older than 12 hours when opened;
   `pnpm sync` syncs everything now (schedule it with launchd if you like).
5. Some large banks use OAuth in Link; if one fails to connect, check the Plaid dashboard's
   OAuth institution registration for your team.
6. `pnpm backup` regularly; restore with
   `docker exec -i supabase_db_fire-calculator psql -U postgres < backups/<file>.sql`.

## Production setup (only if you ever host it publicly)

1. **Supabase**: create a project. In Authentication, enable TOTP MFA, set the site URL to the
   app URL, and keep sign-up confirmations on. Note the project URL, anon key, and the Postgres
   connection string (session pooler).
2. **Migrate**: `DATABASE_URL=<session pooler URL> pnpm db:migrate`. Confirm
   `select count(*) from pg_tables where schemaname = 'fire'` returns 17 and that `anon` and
   `authenticated` have no usage on schema `fire`.
3. **Cloudflare**:
   - `wrangler hyperdrive create fire-db --connection-string=<session pooler URL>`; put the id in
     `apps/web/wrangler.jsonc` (`hyperdrive[0].id`).
   - `wrangler queues create fire-plaid-sync`.
   - Set vars in `wrangler.jsonc`: `PLAID_ENV` to `production`, `APP_BASE_URL` to the https URL,
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PLAID_WEBHOOK_URL`
     (`<APP_BASE_URL>/api/plaid/webhook`).
   - Secrets: `wrangler secret put PLAID_CLIENT_ID`, `PLAID_SECRET` (production or Trial),
     `TOKEN_ENCRYPTION_KEYS` (a fresh key, never the local one), `CRON_SECRET`.
4. **Plaid**: request Production (or use the Trial plan, 10 live Items). Complete the security
   questionnaire with `docs/SECURITY.md`, publish `docs/PRIVACY.md`, register OAuth redirect URIs
   if you add OAuth institutions, and confirm your banks connect on your plan.
5. **Deploy**: `node ops/preflight.mjs`, then `pnpm --filter @fire/web deploy`
   (builds the Worker, refuses a bundle containing local secrets, deploys).
6. **Verify**: `APP_URL=<https URL> CRON_SECRET=<secret> node ops/health.mjs` must print
   `PRODUCTION_HEALTH_VERIFIED`. Then sign up, enroll TOTP, connect one bank, review spending,
   and spot-check three account balances against the bank.

## Operations

| Situation | What to do |
|---|---|
| An Item shows "Sign-in needed" | The user clicks Reconnect on Connections (Plaid Link update mode). Plaid also sends `LOGIN_REPAIRED` when fixed elsewhere. |
| "Reconnect soon" (consent expiring) | Same as above before the date shown. |
| New accounts at a bank | Connections shows "Add new accounts" (update mode with account selection). |
| Missed webhooks | The daily cron (09:17 UTC) syncs every healthy Item. "Refresh now" forces one. |
| Rotate the token key | Add `N+1:<key>` to `TOKEN_ENCRYPTION_KEYS` (highest encrypts). Re-seal rows: `reseal()` in `@fire/db/crypto` over every `fire.plaid_items` row (a one-off script with the production `DATABASE_URL`), then remove the old version. |
| Rotate `CRON_SECRET` | `wrangler secret put CRON_SECRET`; nothing else holds it. |
| A user asks for deletion | They use "Delete everything" (revokes Items at Plaid, purges rows, leaves a tombstone). An operator can run `purgeHousehold` for a household id. |
| Plaid reports an error code | Look at `fire.sync_events` for the Item (kind, status, error_code) and Plaid's docs for the code. |
| Suspected token leak | Rotate `PLAID_SECRET` at Plaid, rotate the token key, and call `/item/remove` for affected Items; users reconnect. |

## Historical data for success rates

`packages/engine/data/us-monthly.json` is built with
`node scripts/data/build-us-monthly.mjs <shiller-format.csv>` (see `packages/engine/data/SOURCES.md`).
