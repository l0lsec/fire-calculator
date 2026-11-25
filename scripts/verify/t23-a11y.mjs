#!/usr/bin/env node
// T2.3 G2: no serious or critical axe violations at 375 px and 1280 px, and no horizontal scroll on phones.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/dashboard.spec.ts"],
  ["dashboard has no serious accessibility violations at 375 and 1280"],
);
pass("DASHBOARD_A11Y_VERIFIED");
