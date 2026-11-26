# Gates: UX rollout leaf 3b-plan

OWNS: apps/web/src/app/(app)/plan/**

Scope: Plan shows essential assumptions first with the rest behind a disclosure, and every save states the FI date before and after.

- [ ] G1: advanced assumptions are collapsed by default and a save reports the FI date change
  CHECK: node scripts/verify/ux-pages.mjs 3b-plan
  EXPECT: UX_LEAF_3B_PLAN_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3b-plan --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
