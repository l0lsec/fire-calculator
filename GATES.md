# Gates: FIRE calculator build plan

OWNS: BUILD_PLAN.md, GATES.md, scripts/verify-plan.mjs

Scope: a complete, ticketed build plan for a FIRE calculator with debt paydown, Plaid-sourced balances and spending, and multiple FI levels including Coast FI, that a coding agent can execute ticket by ticket under unlazy gates.

- [x] G1: the plan has every required section (scope, stack, architecture, data model, Plaid integration, spending derivation, debt engine, FI levels, projection engine, UI, security, phases, depth tree, risks, open decisions)
  CHECK: node scripts/verify-plan.mjs sections
  EXPECT: SECTIONS_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=SECTIONS_VERIFIED

- [x] G2: every FI level (Lean, FI, Fat, Barista, Coast) has a stated formula and every one is covered by an engine ticket gate
  CHECK: node scripts/verify-plan.mjs levels
  EXPECT: LEVELS_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=LEVELS_VERIFIED

- [x] G3: the worked-example figures in the plan match an independent recomputation from its stated inputs (FI levels, Coast FI date, avalanche and snowball payoff)
  CHECK: node scripts/verify-plan.mjs example
  EXPECT: EXAMPLE_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=recomputed: {"leanFI":1000000,"fi":1500000,"fatFI":2250000,"baristaFI":900000,"coastFIToday":382640.455714625,"coastFIMonths":158,"fiMonths":279,"avalanche":{"months":42,"totalInterest":7516.55},"snowball":{"months":42,"totalInterest":7918.

- [x] G4: every ticket declares Depends, Owns and at least one gate with a success token; dependencies reference real tickets and the graph is acyclic; tickets in the same wave own disjoint paths
  CHECK: node scripts/verify-plan.mjs tickets
  EXPECT: TICKETS_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=tickets=26 waves=8 gates=58 | TICKETS_VERIFIED

- [x] G5: the plan names the Plaid endpoints and webhooks it relies on, and the spending rules that prevent double counting
  CHECK: node scripts/verify-plan.mjs plaid
  EXPECT: PLAID_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=PLAID_VERIFIED

- [x] G6: no em dash appears in any owned file, and the em dash detector fails on a positive control
  CHECK: node scripts/verify-plan.mjs emdash
  EXPECT: EMDASH_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=EMDASH_VERIFIED

- [x] G7: the ticket-structure and example checks fail on deliberately broken copies of the plan (negative controls)
  CHECK: node scripts/verify-plan.mjs selftest
  EXPECT: SELFTEST_VERIFIED
  EVIDENCE: exit=0; shell=/bin/sh; cwd=<repo>; path=cac86490b0a1/25 entries; output=recomputed: {"leanFI":1000000,"fi":1500000,"fatFI":2250000,"baristaFI":900000,"coastFIToday":382640.455714625,"coastFIMonths":158,"fiMonths":279,"avalanche":{"months":42,"totalInterest":7516.55},"snowball":{"months":42,"totalInterest":7918.

- [x] G8: domain-expert review pass: the plan's treatment of debt-at-FI, mortgage escrow, nominal vs real dollars, pre-59.5 access and credit-card double counting is correct and not the cheap version
  EVIDENCE: manual review 2026-11-25. debt-at-FI: section 7 adds balances (PV of remaining payments at the debt's own rate equals balance), three policies, enforced by T1.5 G3. escrow: section 6 rule 5 splits P&I from escrow, escrow persists after payoff, T13 G1. nominal vs real: section 9 simulates nominal and deflates, T14 G1. pre-59.5: section 8 interim warning plus T4.1 ladder/Rule of 55; fixed in review: Roth contribution basis is manual (Plaid lacks it). card double counting: section 6 rule 3 plus unlinked-card case, T32 G1/G2. Also fixed in review: avalanche-vs-snowball property softened to "beyond rounding", Barista bridged gate made precise, passkey claim made conditional on Supabase support. Self-review only; no second reviewer.
