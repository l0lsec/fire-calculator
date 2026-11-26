# Gates: UX rollout leaf 3b-plan

OWNS: apps/web/src/app/(app)/plan/**

Scope: Plan shows essential assumptions first with the rest behind a disclosure, and every save states the FI date before and after.

- [x] G1: advanced assumptions are collapsed by default and a save reports the FI date change
  CHECK: node scripts/verify/ux-pages.mjs 3b-plan
  EXPECT: UX_LEAF_3B_PLAN_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/ux-flows.spec.ts) | UX_LEAF_3B_PLAN_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3b-plan --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 6 passed (e2e/specs/onboarding.spec.ts, e2e/specs/flows.spec.ts, e2e/specs/phase4.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in the browser pane at 1280 (Enter saves Assumptions and reports "FI date moved 2 yr 4 mo earlier") and in e2e screenshots at 375 and 1280: evidence/web-2-plan-save-reports-fi-move-1280.jpg, web-plan-375.jpg, web-plan-1280.jpg. Found and fixed: Assumptions could never save in "stop at FI" mode (blank chosen age read as 0); money prefilled as 60000.00; birth month hint said YYYY-MM.
