# Gates: UX rollout phase 5 (verify like a user)

OWNS: scripts/verify/t23-a11y.mjs, e2e/specs/dashboard.spec.ts

Scope: every page passes axe and the full suites, and the primary paths were walked by keyboard and in the browser at three widths.

- [ ] G1: axe finds no serious or critical violations on every app page at 375 and 1280 px
  CHECK: node scripts/verify/t23-a11y.mjs
  EXPECT: DASHBOARD_A11Y_VERIFIED
  EVIDENCE: pending

- [ ] G2: lint, typecheck, unit tests and guards pass
  CHECK: node scripts/verify/ux-check.mjs suites
  EXPECT: UX_SUITES_OK
  EVIDENCE: pending

- [ ] G3: keyboard-only walk of setup, link a bank, and debt planning at 375, 768 and 1280 px, with error and Undo paths exercised (screenshots)
  EVIDENCE: pending
