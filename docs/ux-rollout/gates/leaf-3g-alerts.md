# Gates: UX rollout leaf 3g-alerts

OWNS: apps/web/src/app/(app)/alerts/**, apps/web/src/app/(app)/history/**

Scope: each alert has one action beside it and export confirms what it wrote.

- [ ] G1: every alert row has exactly one action and export shows a completion message
  CHECK: node scripts/verify/ux-pages.mjs 3g-alerts
  EXPECT: UX_LEAF_3G_ALERTS_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3g-alerts --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
