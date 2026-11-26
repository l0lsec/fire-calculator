# UX rollout plan: the 20 laws across FIRE Planner

Status: Phase 0 done on branch `claude/ux-design-principles-4482fd` (this plan, `docs/UX_PRINCIPLES.md`,
`CLAUDE.md`, the global pointer, `scripts/verify/ux-check.mjs`). Phases 1 to 5 are planned only; each has a
ledger in `docs/ux-rollout/gates/`.

## What the survey found (measured 2026-11-26 on 4328e00)

The base is better than average. `components/ui.tsx` and `components/action-form.tsx` already give one
`Button` (40 px, four variants), `Field` with label, hint and inline error, `ActionForm` with a pending label
and inline field errors, `Notice`, `Card`, and color tokens in `globals.css` with dark mode. The money parsers
in `server/forms.ts` already accept `$`, commas and `%`. No page hard-codes a color. The debt planner runs the
engine in the browser. The weak layer is **feedback, recovery and wayfinding**.

Measured figures (re-checked by `node scripts/verify/ux-check.mjs survey`):

<!-- survey: windowConfirm=2 confirmProps=6 buttonForms=23 rawErrors=3 navItems=10 connectionsInNav=0 uiFiles=37 -->

| Signal | Count | Where | Law |
|---|---|---|---|
| `window.confirm(` call sites (blocking, unstyled, no Undo) | 2 | `ButtonForm`, `connections/iphone-pair.tsx` | 14, 15, 18 |
| `confirm=` prompts passed to `ButtonForm` | 6 | debts, plan, accounts, scenarios, connections (2) | 14, 18 |
| `ButtonForm` uses, each a 32 px (`min-h-8`) `text-xs` target | 23 | 9 on spending alone, 4 each on plan and connections | 2 |
| raw provider `error.message` shown to the user | 3 | `(auth)/credentials-form.tsx` (1), `(auth)/mfa/mfa-form.tsx` (2) | 15, 19 |
| top-level nav entries, flat | 10 | `app/(app)/layout.tsx` `NAV` | 1, 3, 9 |
| Connections in the nav | 0 | reachable only from links on Accounts, Bills, Spending | 3 |
| UI files surveyed (`.tsx` under `apps/web/src/app` and `components`) | 37 | | |

Findings by law, beyond the table:

- **15 (recoverable), confirmed bug:** React 19.2 calls `requestFormReset` before every `<form action>` runs
  (`react-dom-client.development.js`, `startHostTransition`). `ActionForm` passes its action that way, so a
  submit that fails validation resets every uncontrolled field to its `defaultValue`: the user's typed values
  are gone exactly when they need fixing. Every form in the app goes through `ActionForm`.
- **6 (Doherty) and 10 (peak-end):** `ButtonForm` disables while pending but keeps its label and says nothing on
  success ("Refresh now", "Check for new data", spending decisions). `ActionForm` success says "Saved." at best;
  no save says what it changed in plan terms (the FI date).
- **14, 18:** deletes are hard deletes in `packages/db` (people, income, contributions, scenarios, budgets,
  transactions, Plaid items), so a real Undo needs either a soft delete or a re-insert. Spending review
  decisions and essential/discretionary toggles are overrides and can be undone cheaply.
- **5, 19 (chunks, complexity):** the Assumptions form has 20 fields in one card; `plan/forms.tsx` has 41 form
  controls in all. Advanced ones (cash return, Fat multiplier, hybrid threshold, emergency months, withdrawal tax,
  raise rate) are always visible.
- **11, 20 (progress):** the dashboard "Let's set up your plan" card lists problems but not done steps or a
  count; the spending review shows "N items to review" in a stat card, not as progress. BUILD_PLAN section 11
  promises an onboarding flow ("usable result in under 5 minutes"); today it is the setup card plus Plan.
- **19:** Connections shows the iPhone's last data time in UTC (`slice(0, 16)` plus "UTC") and `lastError` raw.
- **7:** Plan has 6 cards each with a primary submit, which is within "one per section"; Spending renders three
  equal-weight buttons per review row with no recommended choice.
- **iPhone app (`ios/FIREPlannerSync/App/ContentView.swift`, 69 lines):** pairing, Wallet access and sync are
  three steps with no numbering or done state; "Unpair" has `role: .destructive` but no confirmation.

## Design: build the pieces once, make regressions fail, then migrate page by page

Same order as the Insights rollout, so both repos read alike: (0) make the rules reachable, (1) shared pieces,
(2) a ratchet so concurrent chats cannot regress, (3) migrate pages, (4) whole flows, (5) verify like a user.

### Phase 0: the principles reach every chat (done)

1. `docs/UX_PRINCIPLES.md`: the owner's 20 laws verbatim, a FIRE Planner checklist (one item per law) and the
   interim rules that hold until Phase 1 ships.
2. `CLAUDE.md` (new; the repo had none): read the doc before UI work, the interim rules, the check command.
3. Chats on other branches and worktrees do not see a new repo `CLAUDE.md` until they rebase, so
   `~/.claude/CLAUDE.md` gets a fire-calculator section naming the doc by absolute path in the main checkout,
   with a `git show` fallback to this branch until it merges. Appended next to the Insights section, which is
   left untouched (the Insights and loan-serv-app chats are running this same request now).
4. Memory entry `fire-ux-principles`.

Ledger: `gates/phase-0.md`.

### Phase 1: shared pieces (one owner, `apps/web/src/components/**`, `globals.css`, `(app)/layout.tsx`)

- **ActionForm keeps input on failure.** Submit through `onSubmit` with `e.preventDefault()` and
  `startTransition(() => formAction(new FormData(form)))`, which does not trigger React's automatic reset, then
  call `form.reset()` only when `state.ok && resetOnSuccess`. An e2e test types a bad value, submits, and finds
  every field still holding what was typed.
- **ButtonForm at full size with feedback:** `min-h-10`, 44 px under `@media (pointer: coarse)`, a pending label
  (`pendingLabel`, default "Working..."), an optional `doneLabel` ("Refreshed") shown for 2 s, errors through
  `explainError`, all announced in one `aria-live="polite"` region.
- **ConfirmDialog** on the native `<dialog>` element (no new dependency): title names the thing, body names the
  consequence, focus starts on Cancel for destructive actions, Escape cancels. `ButtonForm confirm=` and
  `iphone-pair.tsx` switch to it, so `window.confirm(` reaches zero.
- **useToast with Undo:** one region in `(app)/layout.tsx`. Undo is offered only where it is real: spending
  review decisions, essential/discretionary toggles, removing a retirement adjustment line. Hard deletes keep
  ConfirmDialog (no fake Undo) unless the owner picks soft delete (Decision 2).
- **explainError(code)** in `apps/web/src/lib/`: maps Supabase auth errors, Plaid codes
  (`ITEM_LOGIN_REQUIRED`, `INSTITUTION_DOWN`, rate limits) and FinanceKit sync errors to "what happened, what to
  do", with the raw code kept for logs only.
- **Nav (Decision 1):** proposed 7 entries in order of use: Dashboard, Plan, Debts, Spending (tabs: Review,
  Budgets, Bills), Scenarios, History, Accounts (tabs: Accounts, Connections). Alerts move to a count badge in
  the header. Phones get the same list in a menu instead of a sideways-scrolling strip.

Ledger: `gates/phase-1-shared.md`.

### Phase 2: the ratchet (so concurrent chats cannot add new debt)

A new guard `scripts/guards/ux.mjs` in the existing guard runner (`scripts/guards/run-all.mjs`, already in CI
with `--selftest`), so `pnpm guards` and CI enforce it. It counts per file under `apps/web/src`:
`window.confirm(` / `alert(`, raw `.error.message` reaching `setError` or JSX, `min-h-8` on a control, hard-coded
colors (`#hex`, `text-red-500` style) in `.tsx`, `<button` without `type`, `<img` without `alt`, more than one
`variant="primary"` inside one `Card`. `scripts/guards/ux-baseline.json` records today's counts. A count above
baseline fails (new debt blocked); a count below baseline also fails until the baseline is lowered (progress is
locked in). Its fixtures prove it trips, like every other guard.

Ledger: `gates/phase-2-ratchet.md`.

### Phase 3: migrate pages (one leaf per area, disjoint ownership, sequential per file)

Each leaf: name the page's one question, one primary action per card, row actions at full size, plain errors,
disabled impossible actions with a stated reason, advanced controls behind disclosure, every `data-testid` kept.

| Leaf | Owns | Focus |
|---|---|---|
| 3a Dashboard | `apps/web/src/app/(app)/dashboard/**` | setup card as a checklist with done steps and "2 of 4"; headline first; fix links become buttons; ladder shows progress since last month |
| 3b Plan | `apps/web/src/app/(app)/plan/**` | Assumptions split into essentials plus "More assumptions"; every save reports the FI date before and after; people and income rows at full size |
| 3c Spending, Budgets, Bills | `apps/web/src/app/(app)/spending/**`, `budgets/**`, `bills/**` | review queue shows "N left" and a recommended choice per row; Undo on decisions; Bills (8 cards) chunked |
| 3d Debts, Scenarios | `apps/web/src/app/(app)/debts/**`, `scenarios/**` | recommended strategy named with the reason; delete through ConfirmDialog naming what changes |
| 3e Accounts, Connections, Connect | `apps/web/src/app/(app)/accounts/**`, `connections/**`, `connect/**` | local time, plain sync errors with Retry; linking a bank ends on "Linked Chase: 3 accounts. First sync running; review spending next" |
| 3f Auth | `apps/web/src/app/(auth)/**` | explainError instead of raw messages; MFA as "Step 1 of 2 / 2 of 2"; sign-up lands on setup |
| 3g Alerts, History | `apps/web/src/app/(app)/alerts/**`, `history/**` | each alert has one action beside it; export confirms what was written |
| 3h iPhone app | `ios/FIREPlannerSync/App/**` | numbered steps with done marks (Pair, Allow Wallet, Sync); `confirmationDialog` before Unpair; plain error text |

Leaves 3a to 3h touch disjoint folders, so they may run in parallel once Phase 1 and 2 have landed on `main`,
but never two writers on one folder, and each leaf first checks `git worktree list` and `git log main` for
recent changes in its folder (bills, budgets and alerts landed in the last two commits from another chat).

Ledgers: `gates/leaf-3a-dashboard.md` to `gates/leaf-3h-iphone.md`.

### Phase 4: whole flows (the laws that live between pages)

- **First run (Zeigarnik, Goal-gradient, Peak-end):** a setup flow derived from existing data, no new table:
  1 People and birth months, 2 Connect a bank or enter spending, 3 Review the top 20 spending items, 4 Check
  assumptions. Shows "Step 2 of 4", resumes at the first unfinished step, and ends on the dashboard with the FI
  date and the one next thing to do. Reachable again from the dashboard while incomplete.
- **Every save ends on its effect:** a shared server helper returns the FI date before and after a plan change so
  Plan, Debts, Spending and Accounts can say "FI date moved from Mar 2041 to Nov 2040".
- **Shortcuts (Parkinson):** Enter submits every form; the rate entry on the dashboard moves to the next debt.

Ledger: `gates/phase-4-flows.md`.

### Phase 5: verify like a user

Browser pane at 375, 768 and 1280 px on every page; keyboard-only walk of setup, link-a-bank and debt
planning; error and Undo paths exercised for real; axe (`scripts/verify/t23-a11y.mjs` extended from the
dashboard to every page) with no serious or critical violations; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm guards`, `pnpm e2e` green. Screenshots are the evidence.

Ledger: `gates/phase-5-verify.md`.

## Risks and traps

1. **e2e specs depend on copy and test ids** (`flows`, `onboarding`, `dashboard`, `debts`, `insights` specs, and
   `scripts/verify/t*.mjs` wrappers that name test titles). Copy changes go with their spec in the same commit;
   no assertion is weakened.
2. **The ActionForm change touches every form.** It ships alone, first in Phase 1, behind its own e2e test, with
   `resetOnSuccess` behavior unchanged.
3. **Undo needs real reversibility.** Do not show Undo for a hard delete. Soft delete is a migration that ships
   to any checkout on its next `pnpm db:migrate` (Decision 2).
4. **Concurrent chats in this repo:** the main checkout session and this worktree. One writer per folder; every
   push goes through the concurrent-editing check in the global CLAUDE.md.
5. **The global CLAUDE.md is shared** with the Insights and loan-serv-app chats running this same request: append
   only, re-read right before editing, never rewrite another project's section.
6. **iPhone leaf needs Xcode** to build and run in the Simulator; FinanceKit is not available there, so the Wallet
   step is checked by its denied and not-paired states, not a real sync.
7. Laws conflict (fewer confirmations vs warn before destruction; Hick vs Tesler). Tiebreak: the owner's order
   (clarity, accessibility, user control, task completion), and in a money app the trustworthy number wins.

## Decisions needed from the owner

1. **Nav:** group the 10 links into 7 with Connections reachable (proposed above), or keep the flat list and
   only add Connections?
2. **Undo for deletes:** keep hard deletes with a ConfirmDialog (recommended, no migration), or add soft delete
   so every delete gets Undo (a migration in `supabase/`)?
3. **One rule for every project:** the global CLAUDE.md now has one section per project (Insights,
   fire-calculator, and likely loan-serv-app). Replace them with one cross-project rule ("read the project's
   `docs/UX_PRINCIPLES.md`; if none, the 20 laws in `~/.claude/UX_PRINCIPLES.md`")?
