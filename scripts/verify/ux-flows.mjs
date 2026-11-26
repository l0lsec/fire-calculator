#!/usr/bin/env node
// UX rollout phase 4 (docs/ux-rollout/gates/phase-4-flows.md).
//   node scripts/verify/ux-flows.mjs <setup|effect|enter>
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

const SPEC = "e2e/specs/ux-flows.spec.ts";
const modes = {
  setup: () => {
    playwright(
      [SPEC],
      ["setup: a new household goes through four visible steps to an FI date, and resumes where it left off"],
    );
    pass("UX_SETUP_FLOW_OK");
  },
  effect: () => {
    vitest(["apps/web/test/plan-effect.test.ts"], ["describes every kind of FI date move"]);
    playwright(
      [SPEC],
      [
        "saves report how the FI date moved, and the dashboard agrees",
        "a spending decision reports how the FI date moved",
      ],
    );
    pass("UX_SAVE_EFFECT_OK");
  },
  enter: () => {
    playwright([SPEC], ["Enter submits a form from any field"]);
    pass("UX_ENTER_SUBMITS_OK");
  },
};
const mode = process.argv[2];
if (!modes[mode]) {
  console.error(`usage: ux-flows.mjs <${Object.keys(modes).join("|")}>`);
  process.exit(1);
}
modes[mode]();
