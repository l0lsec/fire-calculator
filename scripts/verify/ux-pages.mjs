#!/usr/bin/env node
// UX rollout phase 3 (docs/ux-rollout/gates/leaf-3*.md). For one area:
//   node scripts/verify/ux-pages.mjs <area>                 the area's promise (its ux-pages test)
//   node scripts/verify/ux-pages.mjs <area> --regressions   every data-testid the e2e specs use still
//                                                           exists, and the area's older specs pass
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { playwright } from "./e2e.mjs";
import { assert, pass, ROOT } from "./lib.mjs";

const AREAS = {
  "3a-dashboard": {
    test: "3a dashboard: the setup checklist counts done steps and the headline comes before detail",
    specs: ["dashboard.spec.ts", "dashboard-fixes.spec.ts", "onboarding.spec.ts"],
  },
  "3b-plan": {
    test: "3b plan: advanced assumptions start collapsed and the essentials are visible",
    also: [["ux-flows.spec.ts", "saves report how the FI date moved, and the dashboard agrees"]],
    specs: ["onboarding.spec.ts", "flows.spec.ts", "phase4.spec.ts"],
  },
  "3c-spending": {
    test: "3c spending: the review shows items left and one suggested choice per row",
    also: [["ux-shared.spec.ts", "undo on a spending decision puts the item back and restores the total"]],
    specs: ["flows.spec.ts", "insights.spec.ts"],
  },
  "3d-debts": {
    test: "3d debts: the planner names the cheapest strategy and why",
    also: [
      [
        "ux-shared.spec.ts",
        "row buttons are full size, show progress, and confirm destructive actions in a dialog",
      ],
    ],
    specs: ["debts.spec.ts", "flows.spec.ts"],
  },
  "3e-connections": {
    test: "3e connections: linking a bank ends on the bank, its account count and the next step",
    specs: ["plaid-fake.spec.ts", "flows.spec.ts"],
  },
  "3f-auth": {
    test: "3f auth: a wrong password and a wrong code get plain messages, and two-step setup shows its steps",
    specs: ["onboarding.spec.ts", "security.spec.ts"],
  },
  "3g-alerts": {
    test: "3g alerts and history: every alert has one action, and export says it started",
    specs: ["insights.spec.ts", "phase4.spec.ts"],
  },
};

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Test ids the specs ask for that no component renders. */
export function missingTestIds() {
  const used = new Set();
  for (const f of walk(join(ROOT, "e2e"), (p) => p.endsWith(".ts")))
    for (const m of readFileSync(f, "utf8").matchAll(/getByTestId\(\s*"([^"]+)"/g)) used.add(m[1]);
  const literal = new Set();
  const prefixes = [];
  for (const f of walk(join(ROOT, "apps/web/src"), (p) => p.endsWith(".tsx"))) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/(?:data-testid|testId)="([^"]+)"/g)) literal.add(m[1]);
    for (const m of t.matchAll(/(?:data-testid|testId)=\{`([^`$]*)\$\{/g)) prefixes.push(m[1]);
  }
  return [...used].filter((id) => !literal.has(id) && !prefixes.some((p) => p && id.startsWith(p)));
}

const [area, flag] = process.argv.slice(2);
const a = AREAS[area];
if (!a) {
  console.error(`usage: ux-pages.mjs <${Object.keys(AREAS).join("|")}> [--regressions]`);
  process.exit(1);
}
if (flag === "--regressions") {
  const missing = missingTestIds();
  assert(missing.length === 0, `e2e specs use test ids no component renders: ${missing.join(", ")}`);
  console.log("every data-testid used by the e2e specs exists");
  playwright(a.specs.map((s) => `e2e/specs/${s}`));
  pass("UX_LEAF_REGRESSIONS_OK");
} else {
  playwright(["e2e/specs/ux-pages.spec.ts"], [a.test]);
  for (const [spec, title] of a.also ?? []) playwright([`e2e/specs/${spec}`], [title]);
  pass(`UX_LEAF_${area.toUpperCase().replace(/-/g, "_")}_OK`);
}
