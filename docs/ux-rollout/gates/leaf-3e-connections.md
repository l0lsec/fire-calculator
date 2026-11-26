# Gates: UX rollout leaf 3e-connections

OWNS: apps/web/src/app/(app)/accounts/**, apps/web/src/app/(app)/connections/**, apps/web/src/app/(app)/connect/**

Scope: Connections shows local times and plain errors with Retry, and linking a bank ends on what was linked and what happens next.

- [ ] G1: no UTC timestamp or raw error is rendered, and a completed link shows the institution, account count and next step
  CHECK: node scripts/verify/ux-pages.mjs 3e-connections
  EXPECT: UX_LEAF_3E_CONNECTIONS_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3e-connections --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
