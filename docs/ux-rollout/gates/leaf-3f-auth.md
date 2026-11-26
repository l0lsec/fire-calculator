# Gates: UX rollout leaf 3f-auth

OWNS: apps/web/src/app/(auth)/**

Scope: sign-in, sign-up and MFA show plain errors and visible steps, and sign-up lands on setup.

- [x] G1: no raw error.message reaches the page and MFA shows its step count
  CHECK: node scripts/verify/ux-pages.mjs 3f-auth
  EXPECT: UX_LEAF_3F_AUTH_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 7 passed (e2e/specs/ux-pages.spec.ts) | UX_LEAF_3F_AUTH_OK

- [x] G2: every data-testid used by e2e specs in this area still exists and its specs pass
  CHECK: node scripts/verify/ux-pages.mjs 3f-auth --regressions
  EXPECT: UX_LEAF_REGRESSIONS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 2 passed (e2e/specs/onboarding.spec.ts, e2e/specs/security.spec.ts) | UX_LEAF_REGRESSIONS_OK

- [x] G3: the UX guard baseline for this area is lowered and the guard runner is clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=GUARDS_CLEAN (358 files, 7 guards)

- [x] G4: seen at 375 and 1280 px (browser pane or e2e screenshots) against the 20-item checklist in docs/UX_PRINCIPLES.md, with screenshots in docs/ux-rollout/evidence/
  EVIDENCE: seen 2026-11-26 in the browser pane at 768 (wrong password keeps the email and shows a plain message; code field focused; Enter submits) and in e2e screenshots at 375 and 1280: evidence/web-6-sign-in-plain-error-768.jpg, web-sign-in-375.jpg, web-sign-in-1280.jpg. Found and fixed: Sign out was announced as the email address.
