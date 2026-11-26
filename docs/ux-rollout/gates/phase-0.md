# Gates: UX rollout phase 0 (principles reach every chat, plan written)

OWNS: docs/UX_PRINCIPLES.md, docs/ux-rollout/**, CLAUDE.md, scripts/verify/ux-check.mjs

Scope: the owner's 20 UX laws are written down with a FIRE Planner checklist, every chat in this repo (any branch, any worktree) is pointed at them, and a measured, gated rollout plan exists. Nothing in apps/ is changed in phase 0.

- [x] G1: docs/UX_PRINCIPLES.md carries all 20 laws verbatim (each numbered heading) and a 20-item FIRE Planner checklist, one item per law
  CHECK: node scripts/verify/ux-check.mjs principles
  EXPECT: UX_PRINCIPLES_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=UX_PRINCIPLES_OK

- [x] G2: the repo CLAUDE.md tells every chat to read the doc before UI work and names the ux-check command
  CHECK: node scripts/verify/ux-check.mjs claude-md
  EXPECT: UX_CLAUDE_MD_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=UX_CLAUDE_MD_OK

- [x] G3: the global ~/.claude/CLAUDE.md points fire-calculator chats at the doc by absolute path, its fallback path exists, and the Insights and loan servicing sections are still intact
  CHECK: node scripts/verify/ux-check.mjs global
  EXPECT: UX_GLOBAL_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=UX_GLOBAL_OK

- [x] G4: every ledger the rollout plan names exists, phase-3 leaves have pairwise disjoint OWNS, and every UI file in apps/web/src and ios/FIREPlannerSync/App is owned by phase 1 or a phase-3 leaf
  CHECK: node scripts/verify/ux-check.mjs plan
  EXPECT: UX_PLAN_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=UX_PLAN_OK

- [x] G5: the survey numbers in the plan match a fresh measurement of apps/web/src (confirm sites, ButtonForm small targets, raw error messages, nav entries)
  CHECK: node scripts/verify/ux-check.mjs survey
  EXPECT: UX_SURVEY_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=measured {"windowConfirm":2,"confirmProps":6,"buttonForms":23,"rawErrors":3,"navItems":10,"connectionsInNav":0,"uiFiles":37} | UX_SURVEY_OK

- [x] G6: the checker can fail: each mode fails on a broken fixture (known positive control)
  CHECK: node scripts/verify/ux-check.mjs control
  EXPECT: UX_CONTROL_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=control no-emdash on a dash: fails as expected (x.md contains an em dash) | UX_CONTROL_OK

- [x] G7: no em dash in any file phase 0 wrote
  CHECK: node scripts/verify/ux-check.mjs no-emdash
  EXPECT: UX_NO_EMDASH_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=UX_NO_EMDASH_OK
