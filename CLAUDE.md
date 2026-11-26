# FIRE Planner: rules for every chat

The build plan is `BUILD_PLAN.md`; how to run things is `docs/RUNBOOK.md`; gate ledgers are checked with
`node ~/.claude/skills/unlazy/scripts/gate-check.mjs`.

## UI work follows the owner's UX principles

Before you design, build or change any page, component, form, nav or flow (`apps/web/src/app/**`,
`apps/web/src/components/**`, `apps/web/src/app/globals.css`, `ios/FIREPlannerSync/App/**`), read
`docs/UX_PRINCIPLES.md`: the owner's 20 UX laws, a FIRE Planner checklist for each, and which shared pieces
exist yet. The rollout plan and its ledgers are in `docs/ux-rollout/`.

The shared pieces have shipped; the doc's status section lists them. In short:

- confirmations through `ButtonForm confirm=` or `ConfirmDialog`, never `window.confirm(` or `alert(`, and only
  for an action that cannot be undone or stops something working;
- feedback through `ActionForm`, `ButtonForm` (with `doneMessage`, `undo`) and `useToast`; no new toast, dialog
  or pending-button helper;
- never show a raw provider `error.message` (Supabase, Plaid, FinanceKit); use `explainError`;
- plan-changing saves wrap their change in `withFiEffect` so they say how the FI date moved;
- no new top-level place in the nav (`apps/web/src/components/app-nav.tsx`) without asking the owner;
- keep every `data-testid` the e2e specs use.

Before finishing a UI change run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm guards` (its UX ratchet
fails on new UX debt) and `node scripts/verify/ux-check.mjs principles`.
