# Gates: UX rollout leaf 3a-dashboard

OWNS: apps/web/src/app/(app)/dashboard/**

Scope: the dashboard answers "when am I free?" first, the setup card is a checklist with done steps and a count, and every fix is one button away.

- [x] G1: the setup checklist shows done and remaining steps with a count, and the headline renders before detail
  CHECK: node scripts/verify/ux-pages.mjs 3a-dashboard
  EXPECT: UX_LEAF_3A_DASHBOARD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 7 passed (e2e/specs/ux-pages.spec.ts) | UX_LEAF_3A_DASHBOARD_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3a-dashboard --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/dashboard.spec.ts, e2e/specs/dashboard-fixes.spec.ts, e2e/specs/onboarding.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in the browser pane at 1280 and 768 (keyboard sign-in, setup card, headline first, alerts after) and in e2e screenshots at 375 and 1280: evidence/web-1-dashboard-1280.jpg, web-5-after-fix-header-768.jpg, web-dashboard-375.jpg, web-new-dashboard-375.jpg, web-new-dashboard-1280.jpg, web-phone-menu-375.jpg. Found and fixed: pct() showed 0% as "%" and 10%/20% as "1%"/"2%"; header wrapped at 768 (inline nav now from 1024).
