# Security and threat model

FIRE Planner holds a household's bank-derived financial data and Plaid access tokens. This document
lists what is protected, from whom, and the control that does it, with the test or gate that proves
each control. It mirrors BUILD_PLAN section 12.

## Assets

| Asset | Where | Why it matters |
|---|---|---|
| Plaid access tokens | `fire.plaid_items`, encrypted | Read access to a household's bank data until revoked |
| Transactions, balances, debts, holdings | `fire.*` tables | Private financial history |
| Session cookies | Browser | Act as the user |
| AI access keys | Held by the user's AI client; `fire.api_tokens` stores only a SHA-256 | Read the plan (and, for write keys, make what-if changes) until revoked or expired |
| Token encryption keys | Worker secret `TOKEN_ENCRYPTION_KEYS` | Decrypt every access token |
| Plaid client secret | Worker secret `PLAID_SECRET` | Call Plaid as the app |

## Threats and controls

| Threat | Control | Proof |
|---|---|---|
| Someone without a second factor reads data | Supabase Auth with TOTP required (AAL2) for every app route and API; middleware plus `requireContext()` | T0.3 G1, G2 |
| A bug reads another household's rows | Every repository function takes a `HouseholdScope`; only auth and Plaid system code can mint one (guard) | T0.2 G2 (every function probed), `scope` guard |
| Supabase anon key is used against our tables | Tables in schema `fire` (not exposed by the REST API), no privileges for `anon`/`authenticated`, RLS enabled with no permissive policy | T0.2 G2 (RLS test), migration `0001_security.sql` |
| Database leak exposes bank access | Access tokens AES-256-GCM encrypted with per-row IV, bound to household and Item by AAD; keys versioned for rotation | T0.2 G3 |
| Token leaks through logs or responses | Tokens never returned or logged; `token-logging` guard; tests capture console output during exchange | T3.3 G1/G2, guard |
| Forged or replayed Plaid webhook | ES256 JWT verified against Plaid's key (kid), `iat` within 5 minutes, body SHA-256 matched in constant time; replays refused by body hash | T3.1 G2, T3.4 G3, T5.1 G1 |
| Cross-site scripting | Nonce-based CSP with `strict-dynamic`; only Plaid Link's hosts allowed for frames and API calls; React escaping | T5.1 G1 (headers on every route; browser check for violations) |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | T5.1 G1 |
| Open redirect after sign-in | `safeNext()` accepts only same-site relative paths | T0.3 access tests |
| Abuse of Plaid or export endpoints | Rate limits per household (Plaid 20/min, export 10/min) and per IP (webhook 300/min); Cloudflare rate-limit binding in production | `rate-limit` tests |
| Spreadsheet formula injection in CSV export | Cells starting with `= + - @` are prefixed | T4.4 tests |
| Secrets committed to git | `secrets` guard in CI; `.env*` ignored; build refuses a bundle containing local secret values | guards, `build-worker.mjs` |
| Local `.env` baked into the Worker bundle | `build-worker.mjs` blanks OpenNext's env module and scans the output for every local secret value | T0.1 G3 |
| Internal routes called from outside | Cron and queue routes require `Bearer CRON_SECRET` (constant-time compare) | T0.3 route crawl (they are not public pages) |
| An AI access key is stolen or over-used | Keys minted only from an AAL2 session; stored as SHA-256 only; read-only by default; expiry, revoke (immediate) and creator-membership checked on every call; 120 requests/min per key; write tools never touch the baseline plan or delete data; foreign `Origin` refused (see `docs/AI_ACCESS.md`) | `ai-access` tests, e2e `ai-access.spec.ts`, T0.3 route crawl (401 without a key) |
| Data kept after the user leaves | Disconnect calls `/item/remove`; "Delete everything" revokes every Item and purges all rows, leaving a tombstone with no personal data | T3.7 G2 |

## Not in scope

- Moving money: the app requests read-only Plaid products and has no payment code.
- Plaid's own security, Supabase's and Cloudflare's platform security.
- A compromised user device or authenticator app.

## Operations

- Rotate the token key: add a new version to `TOKEN_ENCRYPTION_KEYS` (highest version encrypts),
  run the reseal job (`docs/RUNBOOK.md`), then remove the old version.
- Webhook URL changes: update `PLAID_WEBHOOK_URL`; existing Items keep their URL until updated
  through `/item/webhook/update`.
- Report a vulnerability: contact the owner directly; do not open a public issue.
