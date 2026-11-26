# Gates: UX rollout phase 4 (whole flows)

OWNS: apps/web/src/app/(app)/setup/**, apps/web/src/server/plan-effect.ts, e2e/specs/ux-flows.spec.ts, scripts/verify/ux-flows.mjs

Scope: a first-run setup flow derived from existing data with visible steps and resume, and every plan-changing save states its effect on the FI date.

- [ ] G1: a new manual household goes from sign-up through four visible steps to a dashboard with an FI date, and leaving mid-way resumes at the first unfinished step
  CHECK: node scripts/verify/ux-flows.mjs setup
  EXPECT: UX_SETUP_FLOW_OK
  EVIDENCE: pending

- [ ] G2: saving assumptions, a debt rate and a spending decision each report the FI date before and after, matching an independent engine run
  CHECK: node scripts/verify/ux-flows.mjs effect
  EXPECT: UX_SAVE_EFFECT_OK
  EVIDENCE: pending

- [ ] G3: Enter submits every ActionForm
  CHECK: node scripts/verify/ux-flows.mjs enter
  EXPECT: UX_ENTER_SUBMITS_OK
  EVIDENCE: pending
