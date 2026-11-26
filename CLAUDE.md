# FIRE Planner: rules for every chat

The build plan is `BUILD_PLAN.md`; how to run things is `docs/RUNBOOK.md`; gate ledgers are checked with
`node ~/.claude/skills/unlazy/scripts/gate-check.mjs`.

## UI work follows the owner's UX principles

Before you design, build or change any page, component, form, nav or flow (`apps/web/src/app/**`,
`apps/web/src/components/**`, `apps/web/src/app/globals.css`, `ios/FIREPlannerSync/App/**`), read
`docs/UX_PRINCIPLES.md`: the owner's 20 UX laws, a FIRE Planner checklist for each, and which shared pieces
exist yet. The rollout plan and its ledgers are in `docs/ux-rollout/`.

Until the Phase 1 shared pieces ship (the doc's status section says when):

- no new `window.confirm(` or `alert(`; pass `confirm=` to `ButtonForm`, and only for an action that cannot be
  undone or stops something working;
- no new toast, dialog or pending-button helper; use `ActionForm`, `ButtonForm`, `Notice`, `Card` from
  `apps/web/src/components/`;
- never show a raw provider `error.message` (Supabase, Plaid, FinanceKit); say what happened and what to do;
- no new top-level entry in `NAV` (`apps/web/src/app/(app)/layout.tsx`) without asking the owner;
- keep every `data-testid` the e2e specs use.

Before finishing a UI change run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm guards` and
`node scripts/verify/ux-check.mjs principles`.
