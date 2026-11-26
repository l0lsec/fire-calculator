# Gates: UX rollout phase 5 (verify like a user)

OWNS: scripts/verify/ux-a11y.mjs, e2e/specs/ux-a11y.spec.ts

Scope: every page passes axe and the full suites, and the primary paths were walked by keyboard and in the browser at three widths.

- [x] G1: axe finds no serious or critical violations on every app page and on sign-in and sign-up at 375 and 1280 px, and no app page scrolls sideways on a phone
  CHECK: node scripts/verify/ux-a11y.mjs
  EXPECT: UX_A11Y_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/ux-a11y.spec.ts, e2e/specs/dashboard.spec.ts) | UX_A11Y_OK

- [x] G2: lint, typecheck, unit tests and guards pass
  CHECK: node scripts/verify/ux-check.mjs suites
  EXPECT: UX_SUITES_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=ok: pnpm guards:selftest | UX_SUITES_OK

- [x] G3: keyboard walk of sign-in, setup and debt planning at 375, 768 and 1280 px with error paths exercised; link-a-bank and Undo exercised in e2e (screenshots)
  EVIDENCE: browser pane 2026-11-26: sign-in with a wrong then right password and the TOTP code by keyboard (768), setup steps 1 to 4 each submitted with Enter, a missing birth month kept "Sam" and focused the month (evidence/web-7-setup-keeps-input-768.jpg), end screen with the FI date (web-9-setup-done-768.jpg), Assumptions saved with Enter (1280), debt planner at 375. Link-a-bank (Plaid window stood in) and Undo run in e2e/specs/ux-pages.spec.ts and ux-shared.spec.ts; web-spending-undo-toast-1280.jpg. The real Plaid Link window was not driven.
