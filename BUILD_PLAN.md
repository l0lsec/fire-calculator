# FIRE Calculator: Build Plan

**Audience:** you, and Claude Code (or another coding agent) working ticket by ticket under `/unlazy` gates
**Target:** a web app that pulls balances, debts and spending from Plaid, plans debt paydown, and projects every FI level (Lean, FI, Fat, Barista, Coast) with dates
**Status:** plan only; no code exists yet. Date of plan: 2026-11-25

---

## How to use this document

1. Each ticket below is one leaf in the Depth Tree (section 14). Ticket `T1.2` becomes leaf `leaf-1.2`; each phase becomes a branch node (`node-1` and so on).
2. Before building, create the unlazy scope `fire-v1`: `.unlazy/fire-v1/PLAN.md` (copy sections 3, 4 and 14 as the shared contract) and one ledger per ticket at `.unlazy/fire-v1/gates/leaf-<id>.md`, using that ticket's **Gates** list as the ledger. Every gate names its check script and the success-only token the script prints after all assertions pass.
3. Hand an agent one ticket at a time: the shared contract, its Owns paths, its ledger. Never the whole plan.
4. A ticket is done only when every gate in its ledger is met with evidence, re-verified by the parent with `--reverify`.

Rules for every ticket:

- TypeScript strict, no `any` in committed code, zod at every trust boundary (HTTP bodies, Plaid responses, DB JSON columns).
- `packages/engine` and `packages/spending` are pure: no I/O, no `Date.now()`, no network, no env. Time enters as an explicit `startMonth`. A guard script enforces this.
- Money from real data (balances, transactions) is stored as integer cents. Projections run in float64 and are rounded only for display.
- Every table carries `household_id`; every query goes through the repository layer in `packages/db`.
- Plaid access tokens never leave the server and are never logged.
- No em dash characters anywhere (code, copy, docs, commits). A CI guard enforces it.
- The app must stay fully usable with zero Plaid connections (manual mode). Plaid is a data source, not a dependency of the math.

---

## 1. Product scope

**What it answers, in order of importance:**

1. "What is my FI number, and what is it really, once my debts are counted?"
2. "When do I reach each FI level (Coast, Lean, Barista, FI, Fat), on my current path?"
3. "Which debts should I pay down, in what order, and what does that do to my dates?"
4. "What did I actually spend last year, split into essential and discretionary?" (pulled from Plaid, corrected by me)
5. "What if?" (retire earlier, add $500/month to debt vs invest, go part time at 45)

**In scope for v1:** single household (one or two adults), Plaid for cash, credit cards, loans, mortgages and investment accounts, manual accounts and debts for anything Plaid cannot see, deterministic projections, debt payoff strategies, the full FI ladder, scenario comparison.

**In scope for v2 (phase 4):** pre-59.5 access check and withdrawal ordering, blended withdrawal tax, Social Security, historical backtest and Monte Carlo success rates, net worth history, export.

**Out of scope:** moving money, placing trades, recommending specific securities, tax filing, multi-household SaaS billing. The app gives estimates for education and planning, not financial advice, and says so on every projection screen.

**Default deployment assumption:** a personal tool for your household on Plaid's Trial plan (up to 10 live Items), built multi-tenant-ready so a public launch later is a policy change, not a rewrite. See Open decisions (section 16).

---

## 2. Stack

Chosen to match what you already run (another project, another project): Next.js on Cloudflare via OpenNext, pnpm workspaces, Drizzle, vitest, fast-check, zod.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, TypeScript strict | One repo for UI, API routes and server actions |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Your existing deploy path; Cron Triggers and Queues for sync |
| Database | Postgres (Supabase) through Cloudflare Hyperdrive | Relational data, RLS as defense in depth |
| ORM | Drizzle + `postgres` driver | Typed schema, plain SQL migrations |
| Auth | Supabase Auth, email + password with TOTP MFA required (AAL2) for all app routes; passkeys if Supabase supports them as a factor at build time | Financial data demands a second factor |
| Plaid | Direct REST over `fetch` with zod-validated responses (`packages/plaid`) | The official Node SDK pulls axios and Node APIs; a 300-line fetch client runs cleanly on Workers |
| Webhook verification | `jose` (ES256 JWT, JWK from Plaid) | Already in your toolbox |
| Background work | Cloudflare Queues (webhook fan-in) + Cron Trigger (daily safety sync) | Webhook handler returns 200 fast; sync runs with retries |
| Charts | Recharts | Line, area and stacked bar cover every view here |
| UI | Tailwind 4 + Radix primitives | Matches another project |
| Tests | vitest, fast-check (property tests), Playwright (e2e against Plaid Sandbox), axe-core | Same as another project |
| Lint/format | Biome, plus repo guard scripts | Matches another project |

**Deliberate omissions:** no Redis, no separate job service, no Plaid Node SDK, no client-side storage of financial data beyond the rendered page.

---

## 3. Architecture

```
fire-calculator/
├── apps/web/                      Next.js app (UI, API routes, server actions, worker entry)
│   └── src/
│       ├── app/(auth)/            sign in, MFA enrolment
│       ├── app/(app)/dashboard/   FI ladder, net worth, savings rate
│       ├── app/(app)/accounts/    accounts list, manual accounts
│       ├── app/(app)/debts/       debt planner
│       ├── app/(app)/spending/    annualized spending, review queue
│       ├── app/(app)/plan/        assumptions and scenario editor
│       ├── app/(app)/scenarios/   side-by-side compare, invest vs prepay
│       ├── app/(app)/connect/     Plaid Link
│       ├── app/(app)/connections/ Item health, re-auth, disconnect
│       ├── app/(app)/history/     net worth history, export
│       ├── app/api/plaid/         link token, exchange, webhook
│       ├── server/                server-only services (one folder per domain)
│       └── worker/                queue consumer and cron handler
├── packages/engine/               pure math: core, debt, cashflow, projection, levels, withdrawal, risk
├── packages/spending/             pure transaction classification and annualization
├── packages/plaid/                fetch client, zod schemas, webhook verifier
├── packages/db/                   Drizzle schema, migrations, repositories, token encryption
├── scripts/verify/                one gate script family per ticket (tNN-*.mjs)
├── scripts/guards/                purity, em dash, secrets-in-logs guards
└── e2e/                           Playwright suites against Plaid Sandbox
```

**Data flow:**

```
Plaid ──webhook──> /api/plaid/webhook ──verify JWT──> Queue ──> sync worker ──> Postgres (raw + normalized)
                                                                                    │
Manual entry ───────────────────────────────────────────────────────────────────────┤
                                                                                    v
                                     server/snapshot: build EngineInput from DB (balances, debts,
                                     annualized spending, scenario assumptions)
                                                                                    │
                                                                                    v
                                     packages/engine (pure) ──> ProjectionResult ──> UI
```

**Engine contract (fixed before fan-out, lives in `.unlazy/fire-v1/PLAN.md`):**

- `EngineInput`: `{ startMonth, household: Person[], accounts: AccountBalance[], debts: Debt[], cashflows: CashflowStream[], assumptions: Assumptions, policy: DebtPolicy }`, defined as zod schemas in `packages/engine/src/core/schema.ts`.
- `runProjection(input): ProjectionResult` returns a monthly timeline (nominal and real), per-debt schedules, the FI ladder with target values and projected dates, and warnings.
- `packages/engine/package.json` declares subpath exports for every module (`./core`, `./debt`, `./cashflow`, `./projection`, `./levels`, `./withdrawal`, `./risk`) in T0.1, so no two tickets ever edit a shared `index.ts`.
- Units: months are integers from `startMonth`; rates are annual decimals; cents for observed money; dollars (float) inside projections.

---

## 4. Data model

Abbreviated Drizzle schema. Every table has `id`, `household_id`, `created_at`, `updated_at`.

| Table | Key columns | Notes |
|---|---|---|
| `households` | `name` | One per user in v1; two `people` max |
| `people` | `birth_month`, `retirement_age_target`, `ss_estimate_monthly`, `ss_claim_age` | Ages drive Coast FI, 59.5 and 65 (Medicare) |
| `plaid_items` | `plaid_item_id`, `institution_id`, `access_token_ciphertext`, `access_token_iv`, `key_version`, `transactions_cursor`, `status` (`healthy`, `login_required`, `pending_disconnect`, `revoked`), `consent_expires_at` | Token encrypted with AES-256-GCM, per-row IV, key from a Workers secret, `key_version` for rotation |
| `accounts` | `source` (`plaid`, `manual`), `plaid_account_id`, `type`, `subtype`, `bucket` (`cash`, `taxable`, `traditional`, `roth`, `hsa`, `excluded`), `bucket_overridden`, `include_in_fi` | Bucket decides tax treatment and FI inclusion |
| `balance_snapshots` | `account_id`, `as_of_date`, `current_cents`, `available_cents` | One per account per day; powers net worth history |
| `holdings` | `account_id`, `security_id`, `quantity`, `value_cents`, `cost_basis_cents` | Cost basis feeds the taxable-gains estimate in T4.1 |
| `debts` | `account_id` (nullable for manual), `kind` (`credit_card`, `student`, `mortgage`, `auto`, `personal`, `heloc`, `medical`, `other`), `balance_cents`, `apr`, `apr_source`, `min_payment_cents`, `min_payment_rule`, `promo_apr`, `promo_ends_on`, `maturity_date`, `escrow_monthly_cents`, `field_provenance` (jsonb) | `field_provenance` records per field whether Plaid or the user set it, so a sync never overwrites a user correction |
| `transactions` | `plaid_transaction_id`, `account_id`, `posted_date`, `amount_cents` (Plaid sign: positive is outflow), `merchant`, `pfc_primary`, `pfc_detailed`, `pending`, `transfer_pair_id` | Raw truth from Plaid, upserted by `plaid_transaction_id` |
| `transaction_overrides` | `transaction_id`, `class`, `essential`, `one_time` | User corrections win over rules |
| `category_rules` | `pfc_detailed`, `class`, `essential` | Household-level defaults (for example, `FOOD_AND_DRINK_RESTAURANT` is discretionary) |
| `scenarios` | `name`, `is_baseline`, `assumptions` (jsonb, zod-validated), `debt_policy`, `extra_debt_payment_cents`, `strategy` | Baseline plus any number of what-ifs |
| `sync_events` | `item_id`, `kind`, `payload_hash`, `status`, `error_code` | Audit log of every webhook and sync run |

Transaction `class` values: `living_expense`, `income`, `transfer`, `debt_payment`, `investment_contribution`, `refund`, `ignore`.

---

## 5. Plaid integration

**Plan tier.** Plaid decommissioned its Development environment in June 2024, and as of April 15, 2026 new US and Canada teams get a Trial plan instead of Limited Production: up to 10 live Items, auto-approved for most developers, upgrade to full Production is one way. Ten Items covers one household. Build and test entirely in Sandbox; move to Trial in T5.3. Verify before relying on it: whether Chase, Bank of America and Wells Fargo (OAuth institutions) connect on the Trial plan.

**Products.** `transactions` required; `liabilities` and `investments` requested as optional products so an Item still links at an institution that lacks one of them. Confirm the `optional_products` and `required_if_supported_products` fields against the current `/link/token/create` reference in T3.3.

| Need | Endpoint / webhook | Used by |
|---|---|---|
| Start Link | `/link/token/create` (with `transactions.days_requested: 730`, webhook URL, `user.client_user_id` = opaque household id) | T3.3 |
| Finish Link | `/item/public_token/exchange` (server side only), then encrypt and store `access_token` | T3.3 |
| Re-auth | `/link/token/create` with `access_token` (update mode) | T3.7 |
| Balances | `/accounts/get` (cached balances, refreshed with each product update). Avoid `/accounts/balance/get` (real-time, billed per call) except on an explicit "refresh now" | T3.5 |
| Spending | `/transactions/sync` with stored cursor, loop while `has_more`, apply `added`, `modified`, `removed`; on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restart from the cursor saved before the loop. Request PFC v2 (`personal_finance_category_version: v2`, released Dec 3, 2025) | T3.4 |
| Debts | `/liabilities/get`: credit cards (`aprs[]`, `minimum_payment_amount`, `last_statement_balance`, `next_payment_due_date`), student loans (`interest_rate_percentage`, `minimum_payment_amount`, `expected_payoff_date`), mortgages (`interest_rate`, `next_monthly_payment`, `maturity_date`, `escrow_balance`) | T3.5 |
| Investments | `/investments/holdings/get` (holdings, cost basis, securities) | T3.5 |
| Disconnect | `/item/remove`, then purge or retain data per user choice | T3.7 |
| Verify webhooks | `/webhook_verification_key/get` (cache JWK by `kid`) | T3.4 |

**Webhooks handled** (all verified first: `Plaid-Verification` header is an ES256 JWT; check `alg`, fetch the key by `kid`, reject if `iat` is older than 5 minutes, compare `request_body_sha256` with the SHA-256 of the raw body):

- `TRANSACTIONS: SYNC_UPDATES_AVAILABLE` -> enqueue sync. It fires only after `/transactions/sync` has been called once for the Item, so call it immediately after exchange.
- `HOLDINGS: DEFAULT_UPDATE`, `INVESTMENTS_TRANSACTIONS: DEFAULT_UPDATE` -> refresh holdings.
- `LIABILITIES: DEFAULT_UPDATE` -> refresh debts.
- `ITEM: ERROR` with `ITEM_LOGIN_REQUIRED` -> mark `login_required`, show re-auth banner.
- `ITEM: PENDING_EXPIRATION` and `ITEM: PENDING_DISCONNECT` -> mark `pending_disconnect`, prompt update mode before the date.
- `ITEM: USER_PERMISSION_REVOKED` -> mark `revoked`, stop syncing.
- `ITEM: NEW_ACCOUNTS_AVAILABLE` -> prompt update mode with account selection.
- `ITEM: LOGIN_REPAIRED` -> mark `healthy`.

**Reliability:** webhooks can be missed, so a daily Cron Trigger enqueues a sync for every healthy Item. Sync is idempotent (upsert by Plaid ids, delete on `removed`). Exponential backoff on 429 and 5xx. Every run writes a `sync_events` row.

**Account subtype to bucket mapping** (user can override per account; T3.5 confirms the full subtype list against Plaid's Account schema):

| Plaid type/subtype | Bucket | In FI portfolio by default |
|---|---|---|
| depository: checking, savings, money market, cd | `cash` | Yes, above the emergency-fund reserve |
| investment: brokerage, non-taxable brokerage account, crypto exchange | `taxable` | Yes |
| investment: 401k, 403b, 457b, ira, sep ira, simple ira, keogh, thrift savings plan | `traditional` | Yes |
| investment: roth, roth 401k | `roth` | Yes |
| investment: hsa | `hsa` | Yes |
| investment: 529, ugma, utma, pension, stock plan (unvested) | `excluded` | No |
| manual: home equity, vehicles, other property | `excluded` | No (shown in net worth only) |

**Gaps Plaid will not fill, so manual entry covers them:** APR on auto and personal loans (Liabilities covers cards, student loans and mortgages; other loan subtypes may arrive as balances only), card APRs some issuers omit (the `aprs` array can be empty), employer-paid health premiums, pension estimates, Social Security, real estate.

**Sandbox fixtures.** Build custom Sandbox users (Plaid's `user_custom` override JSON) checked into `e2e/fixtures/plaid/`: one household with a high-APR card, a mortgage with escrow, a student loan, a 401k, a Roth, a brokerage account, paychecks, mortgage payments that include escrow, internal transfers and a credit card payment. These same fixtures drive the spending-pipeline golden tests.

---

## 6. Spending derivation

This is where most FIRE tools are quietly wrong. Annual spending is the denominator of every FI number, so double counting by 20% moves the FI date by years.

**Pipeline (pure, in `packages/spending`):**

1. **Window:** trailing 12 full months of posted (not pending) transactions on depository and credit accounts. With less history, annualize and warn. Twelve months, not three, because insurance, travel and holidays are lumpy.
2. **Internal transfer matching:** pair an outflow and an inflow of equal absolute amount across two linked accounts within 3 days. Both legs become `transfer` regardless of category. This catches savings moves and brokerage funding.
3. **Credit card payment rule:** a payment from checking to a linked credit card is a `transfer`, never spending, because the card's purchases are already counted line by line. A payment to an unlinked card cannot be itemized, so it is counted as spending and flagged "link this card for detail."
4. **Debt payments:** loan payments (`LOAN_PAYMENTS` categories, or a matched payment to a linked loan account) are `debt_payment` and are excluded from living expenses. The debt engine models them separately, because they stop when the debt is gone.
5. **Mortgage escrow:** a mortgage payment = principal and interest + escrow. P&I goes to the debt engine; escrow (property tax, homeowners insurance) is a permanent `living_expense` that continues after payoff. Escrow monthly = `next_monthly_payment` minus the P&I computed from balance, rate and remaining term; the user can override.
6. **Investment contributions:** transfers into investment accounts are `investment_contribution`, not spending. Payroll-deducted 401k contributions never appear in checking; they come from investment transactions and count toward the savings rate.
7. **Refunds** net against the category of the original purchase.
8. **Rules then overrides:** PFC v2 detailed category -> `category_rules` default -> `transaction_overrides`. Primary categories `INCOME`, `TRANSFER_IN`, `TRANSFER_OUT`, `LOAN_PAYMENTS` never become living expenses without an explicit override.
9. **One-time flags:** a transaction over 3x the category's median month, or over a user threshold, goes to the review queue. The user marks it one-time (excluded or amortized over N years) or recurring.
10. **Essential vs discretionary:** each detailed category maps to essential or discretionary (rent, utilities, groceries, insurance, medical, minimum transport are essential by default). Essential spend is the Lean FI basis.

**Output:** `AnnualSpending { totalCents, essentialCents, discretionaryCents, byCategory[], monthsOfData, warnings[], reviewQueue[] }`.

**Retirement spending is not current spending.** The scenario editor starts from `AnnualSpending` and applies explicit adjustments: add health insurance until 65 (employer-paid premiums are invisible to Plaid), remove work costs (commute, work clothes) if the user chooses, add travel goals. Each adjustment is a named line, never a hidden multiplier.

**Savings rate** = (take-home income + pre-tax contributions - living expenses - debt interest) / (take-home income + pre-tax contributions). Principal paid on debt counts as saving.

---

## 7. Debt engine

**Per-debt monthly amortization:** interest accrues as `balance * apr / 12` (credit cards really use average daily balance; monthly accrual is within a few dollars and the approximation is documented), then the payment applies. Promo APR applies until `promo_ends_on`. Negative amortization (minimum below interest) raises a warning, never a silent infinite loop; the simulator caps at 600 months.

**Minimum payment rules:** fixed (loans, mortgages) or card-style `max(floor, pct * balance + interest)` with floor and pct editable (defaults: $35, 1%). Plaid's current `minimum_payment_amount` seeds month 1.

**Strategies:**

| Strategy | Order of extra dollars |
|---|---|
| Avalanche | Highest APR first (ties: lowest balance) |
| Snowball | Lowest balance first (ties: highest APR) |
| Custom | User-dragged order |
| Hybrid threshold | Avalanche among debts with APR above a threshold (default 7%); below it, extra money is invested instead |
| Minimums only | No extra; the baseline for "interest saved" |

All strategies use a fixed monthly debt budget = sum of current minimums + extra. When a debt is paid off, its minimum rolls into the next target (the "rollover"), and leftover dollars in the payoff month flow to the next target in the same month.

**Outputs per strategy:** debt-free date overall and per debt, total interest, month-by-month schedule, interest saved versus minimums-only.

**Invest vs prepay:** for each debt, compare its APR with the scenario's expected nominal return after tax. Show the difference in projected FI date for "extra $X to debt" versus "extra $X to taxable investing," computed by running both scenarios, not by comparing rates alone. The screen states the trade-off (guaranteed return vs expected return) and does not recommend.

**Debt at FI (the policy that makes FI numbers honest):** by default, the FI target at month t includes every debt balance still outstanding at t. Reason: remaining payments on a debt, discounted at that debt's own rate, equal its balance, so a portfolio that funds your expenses and also holds the payoff amount is genuinely free. Policies:

| Policy | FI target at month t |
|---|---|
| Pay off at FI (default) | `E_level / w + sum(all debt balances at t)` |
| Keep mortgage, optimistic | `E_level / w + non-mortgage balances + PV(remaining mortgage P&I at the expected portfolio return)` |
| Debt-free first | Not FI until all non-mortgage debt is zero, then `E_level / w + mortgage balance` |

Because balances fall over time, the target falls over time, and the simulator finds the first month the portfolio crosses it.

---

## 8. FI levels

Notation: `w` = safe withdrawal rate (default 4%; the scenario editor suggests 3.25% to 3.5% for retirements longer than 40 years and says why). `E` = annual retirement living expenses in today's dollars, excluding debt service, after section 6 adjustments. `E_ess` = essential share. `D(t)` = debt term from the policy in section 7. `r` = real expected return. `A_ret` = traditional retirement age (default 60). All targets are in today's dollars; the engine converts.

### Lean FI

**Formula:** `LeanFI = E_ess / w + D(t)`

Covers essentials only. Shown with the warning that any discretionary spending must come from elsewhere.

### FI (regular)

**Formula:** `FI = E / w + D(t)`

The headline number.

### Fat FI

**Formula:** `FatFI = (E * m_fat) / w + D(t)`, with `m_fat` default 1.5, or an absolute annual target the user enters.

### Barista FI

**Formula (perpetual):** `BaristaFI = max(0, E + H - I_pt) / w + D(t)`, where `I_pt` = part-time net income and `H` = extra health cost if the part-time job does not provide coverage.

**Bridged variant (simulated):** part-time income until age `X`, then full FI. The smallest portfolio today that, withdrawing the gap `E + H - I_pt` each year with no contributions, still reaches `FI(X)` at age `X`. This is solved by the simulator, not a closed form.

### Coast FI

**Formula:** `CoastFI(t) = FI(A_ret) / (1 + r)^(A_ret - age(t))`

You are Coast FI at the first month the invested portfolio is at least `CoastFI(t)`: from then on, with zero new contributions, growth alone reaches the FI number by `A_ret`, and work only needs to cover current spending and debt payments. `FI(A_ret)` uses the debts projected to remain at `A_ret` under minimum payments (usually zero). The Coast FI date is found by stepping the contribution path month by month, because both sides move: the portfolio grows and the required amount rises as `A_ret` gets closer.

### The FI ladder (milestones shown on the dashboard)

Each with current value, target, progress and projected date:

1. Emergency fund: cash at or above 3 to 6 months of essential spending (user picks).
2. High-interest debt free: no debt above the hybrid threshold APR.
3. Consumer debt free: all non-mortgage debt at zero.
4. Coast FI.
5. Half FI: 50% of the FI target.
6. Lean FI.
7. Barista FI (if part-time income is set).
8. FI.
9. Fat FI.
10. Fully debt free, including the mortgage.

**Pre-59.5 access (phase 4, T4.1):** reaching FI at 45 with everything in a 401k is not usable FI. T4.1 adds an "accessible FI" check: taxable + cash + Roth contribution basis must cover spending from the FI date to 59.5, unless the plan uses a Roth conversion ladder (5-year seasoning), Rule of 55 or 72(t). Until T4.1 ships, the dashboard shows the share of the portfolio in traditional accounts and a warning when FI age is under 59.5.

**Taxes on withdrawals:** v1 uses one editable effective rate (default 10%) that grosses up the target: `target / (1 - tax)`. T4.1 replaces it with a blended estimate from bucket mix and cost basis.

---

## 9. Projection engine

**Monthly simulation, nominal dollars inside, real dollars for display.** Debts are fixed nominal contracts, expenses grow with inflation, and returns are nominal, so the only correct place to mix them is in nominal terms. Every output series is also deflated by cumulative inflation to today's dollars, which is what the UI shows by default.

Each month `t` from `startMonth`, during accumulation:

1. Grow each bucket at the nominal monthly rate `(1 + R)^(1/12) - 1`.
2. Income: take-home pay (grows with raise assumption) plus part-time income where scheduled; pre-tax contributions go straight into their buckets.
3. Outflows: living expenses (inflated), debt payments from the debt engine (budget and strategy from the scenario).
4. Surplus goes to buckets per the scenario's allocation (default: taxable). A deficit draws cash down to the emergency reserve, then taxable, and raises a warning.
5. Evaluate every FI ladder level against its target at `t`; record the first month each is met.

**Retirement phase (for success checks and charts):** withdrawals of `E` (inflated) plus kept-debt payments, from buckets in a fixed order (cash above reserve, taxable, traditional, Roth) until life expectancy (default 95). T4.1 makes the order configurable and tax-aware; T4.2 replaces the single return path with historical and Monte Carlo paths.

**Assumptions (scenario, all editable, all shown on every chart):** nominal return (default 7%), inflation (default 3%), so real about 3.9%; `w` 4%; raises 3% nominal; retirement age 60; life expectancy 95; emergency months 6; hybrid threshold 7%; `m_fat` 1.5; withdrawal tax 10%.

**Invariants the property tests enforce:**

- With no debt, no contributions and no inflation, the simulated Coast FI date matches the closed form within one month.
- Adding extra debt payment never makes the debt-free date later.
- Avalanche total interest is never higher than snowball's for the same budget, beyond rounding (a counterexample from the property test is a bug report, not a reason to weaken the test).
- Raising `w` never makes any FI date later; raising expenses never makes one earlier.
- Real and nominal series agree after deflation to within a cent per $1M.

---

## 10. Worked example

These figures are the engine's golden fixture: T1.2 and T1.5 must reproduce them exactly (dates to the month, dollars to the dollar). The plan's own gate recomputes them independently. Conventions: real return, monthly compounding at `(1 + r)^(1/12) - 1`, contributions at month end; debts accrue `apr / 12` monthly, minimums first, then the extra (plus rolled-over minimums) to the target; fixed minimums in this example.

```json worked-example
{
  "inputs": {
    "age": 32,
    "retirementAge": 60,
    "annualExpenses": 60000,
    "essentialExpenses": 40000,
    "partTimeIncome": 24000,
    "fatMultiplier": 1.5,
    "swr": 0.04,
    "realReturn": 0.05,
    "portfolio": 150000,
    "monthlyContribution": 2000,
    "extraDebtPayment": 500,
    "debts": [
      { "name": "credit card", "balance": 8000, "apr": 0.2499, "minPayment": 240 },
      { "name": "personal loan", "balance": 3500, "apr": 0.11, "minPayment": 150 },
      { "name": "car loan", "balance": 18000, "apr": 0.069, "minPayment": 400 },
      { "name": "student loan", "balance": 30000, "apr": 0.055, "minPayment": 325 }
    ]
  },
  "expected": {
    "leanFI": 1000000,
    "fi": 1500000,
    "fatFI": 2250000,
    "baristaFI": 900000,
    "coastFIToday": 382640,
    "coastFIMonths": 158,
    "fiMonths": 279,
    "avalanche": { "months": 42, "totalInterest": 7516.55 },
    "snowball": { "months": 42, "totalInterest": 7918.59 }
  }
}
```

Reading it: with $60k of retirement spending this household's FI number is $1.5M (before debt and taxes). At 32, $382,640 invested today would coast to $1.5M by 60. Starting from $150k and adding $2,000 a month, they cross Coast FI in 158 months (about age 45) and full FI in 279 months (about age 55). On the debt side, a $1,615 monthly budget clears all four debts in 42 months either way, but avalanche saves about $402 of interest over snowball here; snowball clears its first debt in 6 months instead of 13, which is the motivational trade the debt screen shows side by side. (The FI figures above leave out the debt term `D(t)` so each piece can be checked on its own; the engine's integrated golden test adds it.)

---

## 11. UI

Responsive web, phone-first layouts for the dashboard and debt screens. Every projection screen shows its assumptions in a chip row (return, inflation, `w`, retirement age) and the "estimates, not financial advice" note.

| Screen | Contents |
|---|---|
| Onboarding | Ages and household, then "Connect accounts" (Plaid) or "Enter manually", then spending review (top 20 review-queue items), then assumptions with defaults explained. Usable result in under 5 minutes |
| Dashboard | FI ladder (progress bars with projected dates), headline FI number with the debt-adjusted figure beside it, net worth, savings rate, a projection chart with level lines |
| Debts | Debt list with APR source badges (Plaid or you), strategy picker, extra-payment slider updating dates live, payoff timeline chart, avalanche vs snowball table, invest vs prepay comparison |
| Spending | Annual total, essential vs discretionary, by category, review queue, one-time flags, per-category essential toggle |
| Plan | Assumptions, retirement-spending adjustments, part-time plans, debt policy |
| Scenarios | Up to 4 scenarios side by side: FI dates per level, debt-free date, total interest, deltas against baseline |
| Accounts / Connections | Accounts by bucket with overrides, Item health, re-auth button, disconnect with "delete my data" option |
| History | Net worth over time from snapshots, CSV and JSON export |

Engine runs on the server for persisted results and also in the browser (it is pure) so sliders update instantly without a round trip.

---

## 12. Security and privacy

- Plaid `access_token` encrypted at rest (AES-256-GCM, per-row IV, key in a Workers secret, `key_version` for rotation); decrypted only inside the sync worker and link services; never returned to the client; never logged (a guard script scans for token-shaped strings in log calls).
- TOTP MFA required for every app route; session cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Every repository function takes `householdId` explicitly; Postgres RLS policies mirror it as defense in depth; a test proves household A cannot read household B through every repository.
- Webhook endpoint is public but accepts only verified Plaid JWTs with fresh `iat` and matching body hash; replayed payloads are rejected by `payload_hash` in `sync_events`.
- CSP with Plaid Link's domains allowed explicitly; no third-party analytics on financial screens.
- Data deletion: disconnect calls `/item/remove`; "delete everything" purges all household rows and writes a tombstone audit record.
- Minimal PII: no SSNs, no account numbers (Plaid `mask` only), no Identity product.
- Plaid production access needs a security questionnaire and privacy policy; T5.3 drafts both from this section.

---

## 13. Phases and tickets

Ticket format: **Wave** (computed from dependencies, see section 14), **Depends**, **Owns** (exact paths this ticket may write), **Deliverable**, **Gates** (each becomes a line in the leaf ledger with its check and success token).

### Phase 0: Foundation

### T0.1 Monorepo scaffold and guards
- **Wave:** 1
- **Depends:** none
- **Owns:** package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .github/**, scripts/guards/**, scripts/verify/t01-**, apps/web/package.json, apps/web/next.config.ts, apps/web/open-next.config.ts, apps/web/wrangler.jsonc, apps/web/tsconfig.json, packages/engine/package.json, packages/spending/package.json, packages/plaid/package.json, packages/db/package.json
- **Deliverable:** pnpm workspace with the four packages and the web app; engine subpath exports pre-declared; CI runs typecheck, lint, tests and guards; guards for engine purity, em dashes and token logging, each with a self-test fixture that must trip it.
- **Gates:**
  - G1: typecheck, lint and an empty test run pass across the workspace. Check `node scripts/verify/t01-skeleton.mjs`, expect `SKELETON_VERIFIED`.
  - G2: every guard fails on its deliberate-violation fixture and passes on the clean tree. Check `node scripts/verify/t01-guards.mjs`, expect `GUARDS_VERIFIED`.
  - G3: `wrangler deploy --dry-run` builds the OpenNext worker bundle. Check `node scripts/verify/t01-bundle.mjs`, expect `BUNDLE_VERIFIED`.

### T0.2 Database schema, repositories and token encryption
- **Wave:** 2
- **Depends:** T0.1
- **Owns:** packages/db/**, scripts/verify/t02-**
- **Deliverable:** Drizzle schema for section 4, migrations, repository layer scoped by `householdId`, RLS policies, AES-GCM token encryption with key rotation.
- **Gates:**
  - G1: migrations apply to an empty database and re-apply as a no-op. Check `node scripts/verify/t02-migrations.mjs`, expect `MIGRATIONS_VERIFIED`.
  - G2: a cross-household read through every repository function returns nothing, and RLS blocks a raw query. Check `node scripts/verify/t02-isolation.mjs`, expect `ISOLATION_VERIFIED`.
  - G3: token encryption round-trips, a tampered ciphertext fails, and a key-version rotation re-encrypts without loss. Check `node scripts/verify/t02-crypto.mjs`, expect `CRYPTO_VERIFIED`.

### T0.3 Auth with required MFA
- **Wave:** 3
- **Depends:** T0.2
- **Owns:** apps/web/src/lib/auth/**, apps/web/src/app/(auth)/**, apps/web/src/middleware.ts, scripts/verify/t03-**
- **Deliverable:** sign up, sign in, TOTP enrolment (passkeys if supported); middleware that rejects any app route without AAL2; household creation on first sign in.
- **Gates:**
  - G1: every route under `(app)` and `api/` except the Plaid webhook returns 401 or redirects without an AAL2 session. Check `node scripts/verify/t03-routes.mjs`, expect `AUTH_ROUTES_VERIFIED`.
  - G2: an AAL1 session (password only) cannot read household data. Check `node scripts/verify/t03-mfa.mjs`, expect `MFA_VERIFIED`.

### Phase 1: Engine (pure)

### T1.1 Engine core: schema, time and rates
- **Wave:** 2
- **Depends:** T0.1
- **Owns:** packages/engine/src/core/**, packages/engine/test/core/**, scripts/verify/t11-**
- **Deliverable:** zod `EngineInput` and `ProjectionResult` schemas, month arithmetic, nominal/real conversion, monthly rate conversion, age-at-month helpers.
- **Gates:**
  - G1: nominal to real and back round-trips within 1e-9 across property-generated inputs. Check `node scripts/verify/t11-rates.mjs`, expect `RATES_VERIFIED`.
  - G2: the purity guard passes on the engine and fails on its fixture. Check `node scripts/verify/t11-purity.mjs`, expect `ENGINE_PURE_VERIFIED`.

### T1.2 Debt amortization and payoff strategies
- **Wave:** 3
- **Depends:** T1.1
- **Owns:** packages/engine/src/debt/**, packages/engine/test/debt/**, scripts/verify/t12-**
- **Deliverable:** section 7 in full: amortization, minimum rules, promo APR, avalanche, snowball, custom, hybrid threshold, minimums-only, rollover, negative-amortization warning, 600-month cap.
- **Gates:**
  - G1: the worked-example avalanche and snowball results match the fixture in section 10 (months and interest to the cent). Check `node scripts/verify/t12-golden.mjs`, expect `DEBT_GOLDEN_VERIFIED`.
  - G2: property tests hold: extra payment never delays payoff; avalanche interest is never above snowball's beyond rounding; balances never go negative. Check `node scripts/verify/t12-properties.mjs`, expect `DEBT_PROPERTIES_VERIFIED`.
  - G3: a debt whose minimum is below its interest returns a warning and terminates. Check `node scripts/verify/t12-negam.mjs`, expect `NEGAM_VERIFIED`.

### T1.3 Cash flow streams
- **Wave:** 3
- **Depends:** T1.1
- **Owns:** packages/engine/src/cashflow/**, packages/engine/test/cashflow/**, scripts/verify/t13-**
- **Deliverable:** time-varying streams: living expenses with inflation, retirement adjustments, health cost until 65, escrow as permanent housing cost, take-home income with raises, part-time income windows, pre-tax contributions.
- **Gates:**
  - G1: mortgage escrow continues after the mortgage payoff month while P&I stops. Check `node scripts/verify/t13-escrow.mjs`, expect `ESCROW_VERIFIED`.
  - G2: health cost stops in the month the person turns 65 and part-time income respects its window. Check `node scripts/verify/t13-windows.mjs`, expect `WINDOWS_VERIFIED`.

### T1.4 Projection simulator
- **Wave:** 4
- **Depends:** T1.2, T1.3
- **Owns:** packages/engine/src/projection/**, packages/engine/test/projection/**, scripts/verify/t14-**
- **Deliverable:** section 9 accumulation and retirement phases, nominal internally with real outputs, deficit handling, warnings.
- **Gates:**
  - G1: with zero inflation the real and nominal series are identical; with inflation they agree after deflation within a cent per $1M. Check `node scripts/verify/t14-real.mjs`, expect `REAL_NOMINAL_VERIFIED`.
  - G2: the worked-example full FI month (279) is reproduced from the fixture inputs with no debts. Check `node scripts/verify/t14-golden.mjs`, expect `PROJECTION_GOLDEN_VERIFIED`.
  - G3: a 600-month projection runs in under 50 ms in Node (so sliders can run it in the browser). Check `node scripts/verify/t14-perf.mjs`, expect `PROJECTION_PERF_VERIFIED`.

### T1.5 FI levels, ladder and debt-at-FI policies
- **Wave:** 5
- **Depends:** T1.4
- **Owns:** packages/engine/src/levels/**, packages/engine/test/levels/**, scripts/verify/t15-**
- **Deliverable:** section 8 in full: Lean FI, FI, Fat FI, Barista FI (perpetual and bridged), Coast FI with date solver, Half FI and the rest of the ladder, three debt policies, withdrawal tax gross-up.
- **Gates:**
  - G1: Lean FI, FI, Fat FI, Barista FI and Coast FI values and the Coast FI month (158) match the section 10 fixture. Check `node scripts/verify/t15-golden.mjs`, expect `LEVELS_GOLDEN_VERIFIED`.
  - G2: the simulated Coast FI date equals the closed form within one month across property-generated inputs with no debt. Check `node scripts/verify/t15-coast.mjs`, expect `COAST_CROSSCHECK_VERIFIED`.
  - G3: under the default policy, adding a debt raises the FI target by exactly its balance at each month, and the FI date never moves earlier. Check `node scripts/verify/t15-debt-policy.mjs`, expect `DEBT_POLICY_VERIFIED`.
  - G4: bridged Barista FI with part-time income equal to expenses, bridged to the retirement age, equals Coast FI to the dollar. Check `node scripts/verify/t15-barista.mjs`, expect `BARISTA_VERIFIED`.

### Phase 2: Manual-mode app

### T2.1 Manual accounts and debts
- **Wave:** 4
- **Depends:** T0.3, T1.1
- **Owns:** apps/web/src/app/(app)/accounts/**, apps/web/src/server/accounts/**, apps/web/src/server/debts/**, apps/web/src/server/snapshot/**, scripts/verify/t21-**
- **Deliverable:** create, edit and delete manual accounts (with bucket) and debts (with APR, minimum rule, promo); `server/snapshot` builds a valid `EngineInput` from the database.
- **Gates:**
  - G1: a household entered by hand produces an `EngineInput` that passes the engine schema. Check `node scripts/verify/t21-snapshot.mjs`, expect `SNAPSHOT_VERIFIED`.
  - G2: invalid input (negative balance, APR over 100%) is rejected server side with field errors. Check `node scripts/verify/t21-validation.mjs`, expect `MANUAL_VALIDATION_VERIFIED`.

### T2.2 Assumptions and scenario editor
- **Wave:** 4
- **Depends:** T0.3, T1.1
- **Owns:** apps/web/src/app/(app)/plan/**, apps/web/src/server/scenarios/**, scripts/verify/t22-**
- **Deliverable:** baseline scenario with section 9 defaults, retirement-spending adjustments as named lines, part-time plans, debt policy and strategy, duplicate-as-what-if.
- **Gates:**
  - G1: every assumption round-trips through the database and the zod schema unchanged. Check `node scripts/verify/t22-roundtrip.mjs`, expect `SCENARIO_ROUNDTRIP_VERIFIED`.

### T2.3 Dashboard and FI ladder
- **Wave:** 6
- **Depends:** T1.5, T2.1, T2.2
- **Owns:** apps/web/src/app/(app)/dashboard/**, apps/web/src/components/charts/**, scripts/verify/t23-**
- **Deliverable:** ladder with progress and dates, headline and debt-adjusted FI number, projection chart with level lines, assumption chips, disclaimer.
- **Gates:**
  - G1: the dashboard for the worked-example household shows the fixture's FI levels and dates. Check `node scripts/verify/t23-render.mjs`, expect `DASHBOARD_VERIFIED`.
  - G2: axe reports no serious or critical violations at 375 px and 1280 px. Check `node scripts/verify/t23-a11y.mjs`, expect `DASHBOARD_A11Y_VERIFIED`.

### T2.4 Debt planner
- **Wave:** 5
- **Depends:** T1.2, T2.1
- **Owns:** apps/web/src/app/(app)/debts/**, scripts/verify/t24-**
- **Deliverable:** strategy picker, live extra-payment slider (engine in the browser), payoff timeline, avalanche vs snowball table, APR source badges.
- **Gates:**
  - G1: moving the slider updates the debt-free date without a network request. Check `node scripts/verify/t24-live.mjs`, expect `DEBT_LIVE_VERIFIED`.
  - G2: the comparison table for the worked example shows 42 months for both strategies and the fixture's interest totals. Check `node scripts/verify/t24-table.mjs`, expect `DEBT_TABLE_VERIFIED`.

### Phase 3: Plaid

### T3.1 Plaid client package
- **Wave:** 2
- **Depends:** T0.1
- **Owns:** packages/plaid/**, scripts/verify/t31-**
- **Deliverable:** fetch client for every endpoint in section 5 with zod response schemas, typed errors (`ITEM_LOGIN_REQUIRED` and friends), retry with backoff on 429 and 5xx, and the webhook JWT verifier.
- **Gates:**
  - G1: recorded Sandbox responses for every endpoint parse; a response with a missing required field fails validation. Check `node scripts/verify/t31-schemas.mjs`, expect `PLAID_SCHEMAS_VERIFIED`.
  - G2: the verifier accepts a valid signed fixture and rejects a wrong body hash, a stale `iat`, an unknown `kid` and `alg: none`. Check `node scripts/verify/t31-webhook.mjs`, expect `WEBHOOK_VERIFY_VERIFIED`.

### T3.2 Spending derivation library
- **Wave:** 3
- **Depends:** T1.1
- **Owns:** packages/spending/**, scripts/verify/t32-**
- **Deliverable:** section 6 pipeline as pure functions producing `AnnualSpending`.
- **Gates:**
  - G1: on the Sandbox fixture household, spending equals the hand-computed total: credit card payments, internal transfers, loan payments and investment contributions are excluded, escrow is included. Check `node scripts/verify/t32-golden.mjs`, expect `SPENDING_GOLDEN_VERIFIED`.
  - G2: a payment to an unlinked card counts as spending and is flagged. Check `node scripts/verify/t32-unlinked.mjs`, expect `UNLINKED_CARD_VERIFIED`.
  - G3: user overrides beat rules, and rules beat PFC defaults. Check `node scripts/verify/t32-precedence.mjs`, expect `PRECEDENCE_VERIFIED`.

### T3.3 Plaid Link and token exchange
- **Wave:** 4
- **Depends:** T0.3, T3.1
- **Owns:** apps/web/src/app/(app)/connect/**, apps/web/src/app/api/plaid/link/**, apps/web/src/server/plaid/link/**, scripts/verify/t33-**
- **Deliverable:** link token endpoint, Link UI, server-side exchange, encrypted storage, first `/transactions/sync` call immediately after exchange.
- **Gates:**
  - G1: a Sandbox Link completes and the stored token decrypts; no response body or log line contains the token. Check `node scripts/verify/t33-link.mjs`, expect `LINK_VERIFIED`.
  - G2: against the fake Plaid API over HTTP, link token, exchange and first sync work through the app's API, and no response or log line contains the token. Check `node scripts/verify/t33-link-fake.mjs`, expect `LINK_FAKE_VERIFIED`.

### T3.4 Sync, webhooks and cron
- **Wave:** 5
- **Depends:** T3.3
- **Owns:** apps/web/src/app/api/plaid/webhook/**, apps/web/src/server/plaid/sync/**, apps/web/src/worker/**, scripts/verify/t34-**
- **Deliverable:** verified webhook endpoint that enqueues, queue consumer running cursor-based sync with mutation-during-pagination restart, daily cron sync, `sync_events` audit.
- **Gates:**
  - G1: running sync twice yields the same rows; a `removed` transaction is deleted; a mutation during pagination restarts cleanly. Check `node scripts/verify/t34-idempotent.mjs`, expect `SYNC_IDEMPOTENT_VERIFIED`.
  - G2: `/sandbox/item/fire_webhook` for `SYNC_UPDATES_AVAILABLE` results in new rows within one queue cycle; an unsigned request is rejected with 401. Check `node scripts/verify/t34-webhook.mjs`, expect `WEBHOOK_FLOW_VERIFIED`.
  - G3: against the fake Plaid API over HTTP, a signed `SYNC_UPDATES_AVAILABLE` delivered to the running app brings new rows; unsigned, tampered and replayed requests are refused. Check `node scripts/verify/t34-webhook-fake.mjs`, expect `WEBHOOK_FLOW_FAKE_VERIFIED`.

### T3.5 Liabilities, investments and balances mapping
- **Wave:** 6
- **Depends:** T3.4, T2.1
- **Owns:** apps/web/src/server/plaid/mapping/**, scripts/verify/t35-**
- **Deliverable:** map Plaid accounts to buckets (section 5 table), liabilities to `debts` with per-field provenance, holdings with cost basis, daily balance snapshots.
- **Gates:**
  - G1: a user-edited APR survives a later liabilities sync, while an unedited field updates. Check `node scripts/verify/t35-provenance.mjs`, expect `PROVENANCE_VERIFIED`.
  - G2: every Plaid investment subtype in the Account schema maps to a bucket, with none falling through to a default silently. Check `node scripts/verify/t35-buckets.mjs`, expect `BUCKETS_VERIFIED`.
  - G3: an empty card `aprs` array produces a "needs APR" task instead of 0%. Check `node scripts/verify/t35-missing-apr.mjs`, expect `MISSING_APR_VERIFIED`.

### T3.6 Spending review UI
- **Wave:** 6
- **Depends:** T3.2, T3.4, T2.2
- **Owns:** apps/web/src/app/(app)/spending/**, apps/web/src/server/spending/**, scripts/verify/t36-**
- **Deliverable:** annual spending views, review queue, one-time flags, essential toggles, "use as retirement baseline" into the scenario.
- **Gates:**
  - G1: marking a transaction one-time changes annual spending and the FI number by the expected amount. Check `node scripts/verify/t36-override.mjs`, expect `SPENDING_OVERRIDE_VERIFIED`.

### T3.7 Item health and disconnect
- **Wave:** 6
- **Depends:** T3.4
- **Owns:** apps/web/src/app/(app)/connections/**, apps/web/src/server/plaid/items/**, scripts/verify/t37-**
- **Deliverable:** status per Item, re-auth through update mode, new-accounts prompt, disconnect with `/item/remove`, delete-my-data.
- **Gates:**
  - G1: Sandbox `ITEM_LOGIN_REQUIRED` (via `/sandbox/item/reset_login`) flips the Item to `login_required` and update mode restores `healthy`. Check `node scripts/verify/t37-reauth.mjs`, expect `REAUTH_VERIFIED`.
  - G2: delete-my-data leaves zero rows for the household in every table except the audit tombstone. Check `node scripts/verify/t37-purge.mjs`, expect `PURGE_VERIFIED`.
  - G3: against the fake Plaid API over HTTP, an `ITEM_LOGIN_REQUIRED` error shows Reconnect on the Connections page and `LOGIN_REPAIRED` restores Connected. Check `node scripts/verify/t37-reauth-fake.mjs`, expect `REAUTH_FAKE_VERIFIED`.

### Phase 4: Advanced planning

### T4.1 Withdrawal access and taxes
- **Wave:** 5
- **Depends:** T1.4
- **Owns:** packages/engine/src/withdrawal/**, packages/engine/test/withdrawal/**, scripts/verify/t41-**
- **Deliverable:** accessible-FI check before 59.5, configurable withdrawal order, Roth conversion ladder with 5-year seasoning, Rule of 55, Roth contribution basis entered by hand (Plaid does not report it), blended withdrawal tax from bucket mix and cost basis, Social Security from claim age.
- **Gates:**
  - G1: a household with FI at 45 and everything in traditional accounts fails the accessible-FI check; the same household with a 5-year ladder started at FI passes from year 5. Check `node scripts/verify/t41-access.mjs`, expect `ACCESS_VERIFIED`.
  - G2: Social Security lowers the target only from the claim age onward. Check `node scripts/verify/t41-ss.mjs`, expect `SS_VERIFIED`.

### T4.2 Historical backtest and Monte Carlo
- **Wave:** 5
- **Depends:** T1.4
- **Owns:** packages/engine/src/risk/**, packages/engine/test/risk/**, packages/engine/data/**, scripts/verify/t42-**
- **Deliverable:** rolling historical sequences from a bundled public monthly US stock, bond and CPI series (source and licence recorded in `packages/engine/data/SOURCES.md`), seeded Monte Carlo, success rate and percentile bands per scenario.
- **Gates:**
  - G1: on the bundled data, a 4% inflation-adjusted withdrawal over 30 years on a 60/40 portfolio succeeds in 90% to 100% of rolling start years (the range the historical studies report), and the script prints the computed rate and the start years that failed. Check `node scripts/verify/t42-historical.mjs`, expect `HISTORICAL_VERIFIED`.
  - G2: the same seed gives identical Monte Carlo output. Check `node scripts/verify/t42-seed.mjs`, expect `MONTE_CARLO_DETERMINISTIC_VERIFIED`.

### T4.3 Scenario compare and invest vs prepay
- **Wave:** 7
- **Depends:** T2.3, T4.1
- **Owns:** apps/web/src/app/(app)/scenarios/**, scripts/verify/t43-**
- **Deliverable:** up to 4 scenarios side by side with deltas, invest vs prepay view per debt.
- **Gates:**
  - G1: comparing a scenario with itself shows zero deltas everywhere. Check `node scripts/verify/t43-identity.mjs`, expect `COMPARE_IDENTITY_VERIFIED`.

### T4.4 Net worth history and export
- **Wave:** 7
- **Depends:** T3.5
- **Owns:** apps/web/src/app/(app)/history/**, apps/web/src/server/export/**, scripts/verify/t44-**
- **Deliverable:** net worth chart from snapshots, CSV and JSON export of accounts, debts, transactions and scenarios.
- **Gates:**
  - G1: a JSON export re-imported into an empty household reproduces the same projection. Check `node scripts/verify/t44-export.mjs`, expect `EXPORT_ROUNDTRIP_VERIFIED`.

### Phase 5: Hardening and launch

### T5.1 Security hardening
- **Wave:** 7
- **Depends:** T3.5, T3.6, T3.7
- **Owns:** apps/web/src/lib/security/**, docs/SECURITY.md, scripts/verify/t51-**
- **Deliverable:** CSP, rate limits on auth and Plaid endpoints, replay protection, secret-scan in CI, written threat model.
- **Gates:**
  - G1: a replayed valid webhook is rejected and CSP headers are present on every app route. Check `node scripts/verify/t51-headers.mjs`, expect `SECURITY_HEADERS_VERIFIED`.
  - G2: manual review of docs/SECURITY.md against section 12, signed off by you.

### T5.2 End-to-end suite on Plaid Sandbox
- **Wave:** 7
- **Depends:** T2.3, T2.4, T3.7
- **Owns:** e2e/**, scripts/verify/t52-**
- **Deliverable:** Playwright flows: onboarding manual, onboarding with Plaid, review spending, change debt strategy, re-auth, disconnect.
- **Gates:**
  - G1: all e2e flows pass against Sandbox on a clean database. Check `node scripts/verify/t52-e2e.mjs`, expect `E2E_VERIFIED`.

### T5.3 Plaid Trial cutover and runbook
- **Wave:** 8
- **Depends:** T5.1, T5.2, T4.3, T4.4
- **Owns:** docs/RUNBOOK.md, docs/PRIVACY.md, ops/**, scripts/verify/t53-**
- **Deliverable:** production secrets set, webhook URL registered, privacy policy, runbook (key rotation, Item errors, data deletion), first real institution linked.
- **Gates:**
  - G1: production health check passes: webhook reachable and verifying, cron registered, no Sandbox keys in production config. Check `node scripts/verify/t53-health.mjs`, expect `PRODUCTION_HEALTH_VERIFIED`.
  - G2: manual: your own accounts linked, spending reviewed, and the dashboard numbers match a hand spot-check of three accounts.

---

## 14. Depth tree and waves

```
root: fire-v1
├── node-0 Foundation ........ leaf-0.1, leaf-0.2, leaf-0.3
├── node-1 Engine ............ leaf-1.1, leaf-1.2, leaf-1.3, leaf-1.4, leaf-1.5
├── node-2 Manual-mode app ... leaf-2.1, leaf-2.2, leaf-2.3, leaf-2.4
├── node-3 Plaid ............. leaf-3.1, leaf-3.2, leaf-3.3, leaf-3.4, leaf-3.5, leaf-3.6, leaf-3.7
├── node-4 Advanced .......... leaf-4.1, leaf-4.2, leaf-4.3, leaf-4.4
└── node-5 Hardening ......... leaf-5.1, leaf-5.2, leaf-5.3
```

**Waves** (a ticket's wave is 1 + the highest wave among its dependencies; tickets in one wave own disjoint paths, so they can run as parallel sessions; dispatch is rolling, so a ticket starts as soon as its own dependencies verify):

| Wave | Tickets |
|---|---|
| 1 | T0.1 |
| 2 | T0.2, T1.1, T3.1 |
| 3 | T0.3, T1.2, T1.3, T3.2 |
| 4 | T1.4, T2.1, T2.2, T3.3 |
| 5 | T1.5, T2.4, T3.4, T4.1, T4.2 |
| 6 | T2.3, T3.5, T3.6, T3.7 |
| 7 | T4.3, T4.4, T5.1, T5.2 |
| 8 | T5.3 |

**Branch integration gates** (each `node-*.md` ledger):

- node-1: all engine leaves re-verified; the integrated golden test (section 10 inputs plus the debts under the default policy) passes; purity guard passes.
- node-2: a manual-only household goes from sign-up to a dashboard with dates in one Playwright run.
- node-3: a Sandbox household goes from Link to a dashboard whose spending matches the T3.2 golden total.
- node-4: scenarios render success rates and accessible-FI warnings for the fixture household.
- node-5: T5.2 suite green on the production build; runbook reviewed.

**Critical path:** T0.1 -> T1.1 -> T1.2 -> T1.4 -> T1.5 -> T2.3 -> T4.3 -> T5.3 (8 waves). A usable manual-mode calculator exists at the end of wave 6; Plaid data flows into it in the same wave.

---

## 15. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Trial plan caps at 10 Items; OAuth banks may need full Production | Some of your banks may not connect | Check your institutions in week 1 of T3.3; manual accounts and CSV import as fallback |
| Liabilities gaps (empty card APRs, no APR on auto and personal loans) | Debt plan built on wrong rates | "Needs APR" tasks (T3.5 G3); APR source badges; engine refuses to run a debt with unknown APR silently |
| Categorization and transfer mistakes | Spending, and so every FI number, wrong by years | Section 6 rules, golden fixture, review queue, overrides that persist |
| Deterministic projections look more certain than they are | False confidence | Assumption chips on every chart; T4.2 success rates and bands; sensitivity on return and `w` |
| Being read as financial advice | Legal and trust | Disclaimer on projection screens; no product or security recommendations; comparisons show trade-offs without telling you what to do |
| Storing bank data | Breach impact | Section 12; minimal PII; delete-my-data; encryption with rotation |
| Workers runtime limits (CPU time, Node APIs) | Sync jobs time out | Queue-based sync per Item, paginated; fetch-only Plaid client; engine benchmark gate (T1.4 G3) |
| Plaid API drift | Broken sync | zod schemas fail loudly; recorded-response tests; changelog check before each phase |

---

## 16. Open decisions

Defaults are chosen so building can start now; each is cheap to change before the ticket that depends on it.

1. **Personal tool or public product?** Default: personal (Trial plan, single household), built multi-tenant-ready. A public launch adds full Plaid Production approval, per-Item pricing, billing, and a stronger compliance posture. Decide before T5.3.
2. **Web only, or an iOS app too?** Default: responsive web first. The pure engine package is reusable in an Expo app (as in another project) later. Decide before phase 5.
3. **Household of two?** Default: yes, data model supports two people (ages matter for 59.5, 65 and Social Security). Decide before T0.2.
4. **Default withdrawal rate:** 4% with a suggestion of 3.25% to 3.5% for retirements over 40 years. Decide before T2.2.
5. **Default debt policy:** pay off at FI (balances added to the target). Decide before T1.5.
6. **Hosting:** Cloudflare + Supabase (your existing stack). Decide before T0.1.
