# Gates: UX rollout leaf 3f-auth

OWNS: apps/web/src/app/(auth)/**

Scope: sign-in, sign-up and MFA show plain errors and visible steps, and sign-up lands on setup.

- [ ] G1: no raw error.message reaches the page and MFA shows its step count
  CHECK: node scripts/verify/ux-pages.mjs 3f-auth
  EXPECT: UX_LEAF_3F_AUTH_OK
  EVIDENCE: pending

- [ ] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3f-auth --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: pending

- [ ] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G4: walked in the browser pane at 375 and 1280 px against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots
  EVIDENCE: pending
