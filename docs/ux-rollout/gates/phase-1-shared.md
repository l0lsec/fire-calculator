# Gates: UX rollout phase 1 (shared pieces)

OWNS: apps/web/src/components/**, apps/web/src/lib/explain-error.ts, apps/web/src/lib/alert-links.ts, apps/web/src/lib/format.ts, apps/web/test/explain-error.test.ts, apps/web/src/app/globals.css, apps/web/src/app/(app)/layout.tsx, apps/web/src/app/layout.tsx, apps/web/src/app/page.tsx, e2e/specs/ux-shared.spec.ts, scripts/verify/ux-shared.mjs

Scope: ActionForm keeps typed values on a failed submit; ButtonForm is full size with pending and done feedback; ConfirmDialog, useToast with Undo and explainError exist and replace every window.confirm; the nav follows Decision 1 (seven places, grouped tabs, a phone menu).

- [x] G1: a submit that fails validation leaves every typed value in place, and resetOnSuccess still clears on success
  CHECK: node scripts/verify/ux-shared.mjs keeps-input
  EXPECT: UX_KEEPS_INPUT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_KEEPS_INPUT_OK

- [x] G2: ButtonForm targets measure at least 40 px (44 px with a coarse pointer), say they are working (aria-busy) within 400 ms of a click, and announce done in the polite Notifications region
  CHECK: node scripts/verify/ux-shared.mjs button-form
  EXPECT: UX_BUTTON_FORM_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_BUTTON_FORM_OK

- [x] G3: ConfirmDialog focuses Cancel for destructive actions, Escape cancels without submitting, confirm submits once; no window.confirm( remains in apps/web/src
  CHECK: node scripts/verify/ux-shared.mjs confirm-dialog
  EXPECT: UX_CONFIRM_DIALOG_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_CONFIRM_DIALOG_OK

- [x] G4: Undo on a spending decision restores the previous classification; no Undo is offered for a hard delete
  CHECK: node scripts/verify/ux-shared.mjs undo
  EXPECT: UX_UNDO_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_UNDO_OK

- [x] G5: explainError maps every known Supabase, Plaid and FinanceKit code it is given to plain text and never returns the raw message
  CHECK: node scripts/verify/ux-shared.mjs explain-error
  EXPECT: UX_EXPLAIN_ERROR_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=vitest: 6 passed, 0 failed (apps/web/test/explain-error.test.ts) | UX_EXPLAIN_ERROR_OK

- [x] G6: lint, typecheck, unit tests and the existing e2e specs still pass
  CHECK: node scripts/verify/ux-shared.mjs regressions
  EXPECT: UX_SHARED_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 35 passed (e2e/specs) | UX_SHARED_REGRESSIONS_OK
