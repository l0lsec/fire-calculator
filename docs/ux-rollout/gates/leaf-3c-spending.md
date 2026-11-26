# Gates: UX rollout leaf 3c-spending

OWNS: apps/web/src/app/(app)/spending/**, apps/web/src/app/(app)/budgets/**, apps/web/src/app/(app)/bills/**

Scope: the spending review shows progress and a recommended choice per row with Undo; budgets and bills are chunked with one primary action per card.

- [ ] G1: the review queue shows items left, marks one recommended choice per row, and Undo reverses a decision
  CHECK: node scripts/verify/ux-pages.mjs 3c-spending
  EXPECT: UX_LEAF_3C_SPENDING_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3c-spending --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
