// Only the auth layer (verified MFA sessions) and Plaid system jobs (Items they
// looked up) may mint a HouseholdScope. Anywhere else, a scope must be passed in.
import { lineOf } from "./lib.mjs";

export const name = "scope";

const ALLOWED = [
  /^packages\/db\/src\/db\.ts$/,
  /^apps\/web\/src\/lib\/auth\//,
  /^apps\/web\/src\/server\/plaid\//,
  /^apps\/web\/src\/worker\//,
  /(^|\/)test\//,
  /\.test\.tsx?$/,
  /^e2e\//,
  /^scripts\//,
];

export function scan(files) {
  const violations = [];
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f.path) || ALLOWED.some((re) => re.test(f.path))) continue;
    for (const m of f.text.matchAll(/\bscopeFor\s*\(/g)) {
      violations.push(
        `${f.path}:${lineOf(f.text, m.index)} mints a HouseholdScope outside auth or system jobs`,
      );
    }
  }
  return violations;
}

export const fixtures = [
  { path: "apps/web/src/app/(app)/dashboard/page.tsx", text: "const s = scopeFor(params.id);\n" },
];
