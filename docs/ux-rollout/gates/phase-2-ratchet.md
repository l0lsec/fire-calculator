# Gates: UX rollout phase 2 (ratchet guard)

OWNS: scripts/guards/ux.mjs, scripts/guards/ux-baseline.json, scripts/guards/run-all.mjs

Scope: a UX guard in the existing guard runner blocks new UX debt in apps/web/src and locks in every reduction, and proves it can fail.

- [ ] G1: the guard's fixtures each trip it and a clean file does not (runner selftest)
  CHECK: node scripts/guards/run-all.mjs --selftest
  EXPECT: GUARDS_SELFTEST_OK
  EVIDENCE: pending

- [ ] G2: the repository is at or below the UX baseline and the runner reports clean
  CHECK: node scripts/guards/run-all.mjs
  EXPECT: GUARDS_CLEAN
  EVIDENCE: pending

- [ ] G3: a count below baseline fails until the baseline is lowered, and a count above baseline fails
  CHECK: node scripts/verify/ux-check.mjs ratchet
  EXPECT: UX_RATCHET_OK
  EVIDENCE: pending
