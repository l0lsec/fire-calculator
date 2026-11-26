# Gates: UX rollout phase 4 (whole flows)

OWNS: apps/web/src/app/(app)/setup/**, apps/web/src/server/plan-effect.ts, apps/web/src/server/setup.ts, apps/web/test/plan-effect.test.ts, e2e/specs/ux-flows.spec.ts, scripts/verify/ux-flows.mjs

Scope: a first-run setup flow derived from existing data with visible steps and resume, and every plan-changing save states its effect on the FI date.

- [x] G1: a new manual household goes from the dashboard through four visible steps ("Step N of 4", "N of 4 done") to an FI date that matches the dashboard, and leaving mid-way resumes at the first unfinished step
  CHECK: node scripts/verify/ux-flows.mjs setup
  EXPECT: UX_SETUP_FLOW_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/ux-flows.spec.ts) | UX_SETUP_FLOW_OK

- [x] G2: saving assumptions, a debt rate and a spending decision each report how the FI date moved (before and after), and the dashboard then shows the after date
  CHECK: node scripts/verify/ux-flows.mjs effect
  EXPECT: UX_SAVE_EFFECT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/ux-flows.spec.ts) | UX_SAVE_EFFECT_OK

- [x] G3: Enter in a field submits the form (income and people forms on Plan)
  CHECK: node scripts/verify/ux-flows.mjs enter
  EXPECT: UX_ENTER_SUBMITS_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=playwright: 4 passed (e2e/specs/ux-flows.spec.ts) | UX_ENTER_SUBMITS_OK
