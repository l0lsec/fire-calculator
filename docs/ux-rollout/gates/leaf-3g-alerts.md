# Gates: UX rollout leaf 3g-alerts

OWNS: apps/web/src/app/(app)/alerts/**, apps/web/src/app/(app)/history/**

Scope: each alert has one action beside it and export confirms what it wrote.

- [x] G1: every alert row has exactly one action and export shows a completion message
  CHECK: node scripts/verify/ux-pages.mjs 3g-alerts
  EXPECT: UX_LEAF_3G_ALERTS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 7 passed (e2e/specs/ux-pages.spec.ts) | UX_LEAF_3G_ALERTS_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3g-alerts --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 3 passed (e2e/specs/insights.spec.ts, e2e/specs/phase4.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in e2e screenshots at 375 and 1280 with a fake-Plaid bank: evidence/web-alerts-375.jpg, web-alerts-1280.jpg, web-history-375.jpg, web-history-1280.jpg. Found and fixed: alert thresholds prefilled as 1000000.
