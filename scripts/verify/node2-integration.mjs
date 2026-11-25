#!/usr/bin/env node
// node-2: a manual-only household goes from sign-up to a dashboard with dates in one Playwright run.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/onboarding.spec.ts"],
  ["a manual-only household goes from sign-up to a dashboard with dates"],
);
pass("MANUAL_MODE_INTEGRATION_VERIFIED");
