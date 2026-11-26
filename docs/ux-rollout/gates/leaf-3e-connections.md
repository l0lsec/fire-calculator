# Gates: UX rollout leaf 3e-connections

OWNS: apps/web/src/app/(app)/accounts/**, apps/web/src/app/(app)/connections/**, apps/web/src/app/(app)/connect/**

Scope: Connections shows local times and plain errors with Retry, and linking a bank ends on what was linked and what happens next.

- [x] G1: no UTC timestamp or raw error is rendered, and a completed link shows the institution, account count and next step
  CHECK: node scripts/verify/ux-pages.mjs 3e-connections
  EXPECT: UX_LEAF_3E_CONNECTIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 7 passed (e2e/specs/ux-pages.spec.ts) | UX_LEAF_3E_CONNECTIONS_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3e-connections --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 7 passed (e2e/specs/plaid-fake.spec.ts, e2e/specs/flows.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in e2e screenshots at 375 and 1280 with a fake-Plaid bank: evidence/web-connections-375.jpg, web-connections-1280.jpg, web-accounts-375.jpg, web-accounts-1280.jpg (local "last updated Nov 26, 3:13 AM", no UTC). The real Plaid Link window was not opened (the e2e test stands in for it).
