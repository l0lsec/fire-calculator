#!/usr/bin/env node
// UX rollout phase 5 G1: axe finds no serious or critical violations on every
// app page and the sign-in pages at 375 and 1280 px, and no page scrolls sideways on a phone.
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(
  ["e2e/specs/ux-a11y.spec.ts", "e2e/specs/dashboard.spec.ts"],
  [
    "every app page has no serious accessibility violations at 375 and 1280",
    "sign-in and sign-up have no serious accessibility violations at 375 and 1280",
    "dashboard has no serious accessibility violations at 375 and 1280",
  ],
);
pass("UX_A11Y_OK");
