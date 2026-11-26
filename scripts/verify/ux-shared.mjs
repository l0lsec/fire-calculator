#!/usr/bin/env node
// UX rollout phase 1 (docs/ux-rollout/gates/phase-1-shared.md): the shared
// pieces behave as promised. Each mode runs the tests that prove one gate and
// prints its success-only token.
//   node scripts/verify/ux-shared.mjs <keeps-input|button-form|confirm-dialog|undo|explain-error|regressions>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playwright } from "./e2e.mjs";
import { assert, pass, ROOT, run, vitest } from "./lib.mjs";

const SPEC = "e2e/specs/ux-shared.spec.ts";
const T = {
  keeps: "a failed save keeps every typed value, and a good save still clears an add form",
  buttons: "row buttons are full size, show progress, and confirm destructive actions in a dialog",
  undo: "undo on a spending decision puts the item back and restores the total",
  noUndo: "a hard delete offers no undo",
  nav: "the main nav marks the current place and shows its tabs",
};

const modes = {
  "keeps-input": () => {
    playwright([SPEC], [T.keeps]);
    pass("UX_KEEPS_INPUT_OK");
  },
  "button-form": () => {
    const src = readFileSync(join(ROOT, "apps/web/src/components/ui.tsx"), "utf8");
    assert(/min-h-10[^"`]*pointer-coarse:min-h-11/.test(src), "Button is not 40 px with 44 px on touch");
    playwright([SPEC], [T.buttons]);
    pass("UX_BUTTON_FORM_OK");
  },
  "confirm-dialog": () => {
    const r = run("node", ["scripts/guards/run-all.mjs"], { quiet: true, allowFail: true });
    assert(r.code === 0 && !/browser-dialog/.test(r.out), "guards report a browser dialog or fail");
    playwright([SPEC], [T.buttons, T.nav]);
    pass("UX_CONFIRM_DIALOG_OK");
  },
  undo: () => {
    vitest(
      ["apps/web/test/spending-review.test.ts"],
      ["marking a transaction one-time changes annual spending and the FI number by the expected amount"],
    );
    playwright([SPEC], [T.undo, T.noUndo]);
    pass("UX_UNDO_OK");
  },
  "explain-error": () => {
    vitest(
      ["apps/web/test/explain-error.test.ts"],
      [
        "gives every known Supabase auth code its own plain sentence",
        "gives every known Plaid code its own plain sentence, in any case and any field",
        "never returns the raw message for unknown errors",
      ],
    );
    pass("UX_EXPLAIN_ERROR_OK");
  },
  regressions: () => {
    for (const s of ["lint", "typecheck"]) run("pnpm", [s], { quiet: true });
    run("pnpm", ["test"], { quiet: true });
    playwright(["e2e/specs"]);
    pass("UX_SHARED_REGRESSIONS_OK");
  },
};

const mode = process.argv[2];
if (!modes[mode]) {
  console.error(`usage: ux-shared.mjs <${Object.keys(modes).join("|")}>`);
  process.exit(1);
}
modes[mode]();
