# Gates: UX rollout leaf 3d-debts

OWNS: apps/web/src/app/(app)/debts/**, apps/web/src/app/(app)/scenarios/**

Scope: Debts names the recommended strategy with its reason; deletes go through ConfirmDialog naming what changes.

- [x] G1: the recommended strategy is named with its reason and deletes use ConfirmDialog
  CHECK: node scripts/verify/ux-pages.mjs 3d-debts
  EXPECT: UX_LEAF_3D_DEBTS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/ux-shared.spec.ts) | UX_LEAF_3D_DEBTS_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3d-debts --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 5 passed (e2e/specs/debts.spec.ts, e2e/specs/flows.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in the browser pane at 375 and 768 (recommendation, "Try avalanche" after choosing snowball) and in e2e screenshots at 375 and 1280: evidence/web-3-debts-recommendation-375.jpg, web-debts-375.jpg, web-debts-1280.jpg, web-debts-confirm-dialog-1280.jpg, web-scenarios-375.jpg, web-scenarios-1280.jpg. Found and fixed: Edit disclosures were small text targets.
