# Gates: UX rollout leaf 3d-debts

OWNS: apps/web/src/app/(app)/debts/**, apps/web/src/app/(app)/scenarios/**

Scope: Debts names the recommended strategy with its reason; deletes go through ConfirmDialog naming what changes.

- [ ] G1: the recommended strategy is named with its reason and deletes use ConfirmDialog
  CHECK: node scripts/verify/ux-pages.mjs 3d-debts
  EXPECT: UX_LEAF_3D_DEBTS_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3d-debts --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
