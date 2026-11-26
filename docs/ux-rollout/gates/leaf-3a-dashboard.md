# Gates: UX rollout leaf 3a-dashboard

OWNS: apps/web/src/app/(app)/dashboard/**

Scope: the dashboard answers "when am I free?" first, the setup card is a checklist with done steps and a count, and every fix is one button away.

- [ ] G1: the setup checklist shows done and remaining steps with a count, and the headline renders before detail
  CHECK: node scripts/verify/ux-pages.mjs 3a-dashboard
  EXPECT: UX_LEAF_3A_DASHBOARD_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3a-dashboard --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
