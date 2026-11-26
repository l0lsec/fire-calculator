# Gates: UX rollout leaf 3c-spending

OWNS: apps/web/src/app/(app)/spending/**, apps/web/src/app/(app)/budgets/**, apps/web/src/app/(app)/bills/**

Scope: the spending review shows progress and a recommended choice per row with Undo; budgets and bills are chunked with one primary action per card.

- [x] G1: the review queue shows items left, marks one recommended choice per row, and Undo reverses a decision
  CHECK: node scripts/verify/ux-pages.mjs 3c-spending
  EXPECT: UX_LEAF_3C_SPENDING_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_LEAF_3C_SPENDING_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3c-spending --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/flows.spec.ts, e2e/specs/insights.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in e2e screenshots at 375 and 1280 with a fake-Plaid bank (the fake API runs only inside the e2e harness): evidence/web-spending-375.jpg, web-spending-1280.jpg, web-budgets-375.jpg, web-budgets-1280.jpg, web-bills-375.jpg, web-bills-1280.jpg, web-spending-undo-toast-1280.jpg. Found and fixed: ISO dates on Spending and Budgets; budget Set button 32 px and its form wiped a bad amount; Bills rows ran name into amount at 375.
