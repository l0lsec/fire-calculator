// Engine and spending packages must be pure: same input, same output, no I/O.
// Time enters as an explicit month index, randomness through a seeded generator.
import { lineOf } from "./lib.mjs";

export const name = "purity";
export const PURE_ROOTS = ["packages/engine/src/", "packages/spending/src/"];

const RULES = [
  [/from\s+["']node:[^"']+["']/g, "imports a node: builtin"],
  [/from\s+["'](fs|path|http|https|net|child_process|os|crypto)["']/g, "imports a Node module"],
  [/\bimport\s*\(/g, "uses dynamic import"],
  [/\brequire\s*\(/g, "uses require"],
  [/\bprocess\./g, "reads process"],
  [/\bDate\.now\s*\(/g, "reads the clock (Date.now)"],
  [/\bnew\s+Date\s*\(\s*\)/g, "reads the clock (new Date())"],
  [/\bMath\.random\s*\(/g, "uses unseeded randomness"],
  [/\bfetch\s*\(/g, "performs network I/O"],
  [/\b(setTimeout|setInterval|queueMicrotask)\s*\(/g, "schedules work"],
  [/\b(localStorage|sessionStorage|indexedDB|document|window)\b/g, "touches a browser global"],
];

const ALLOWED_IMPORTS = /^(zod|@fire\/engine\/[a-z]+|\.{1,2}\/.*)$/;

export function scan(files) {
  const violations = [];
  for (const f of files) {
    if (!PURE_ROOTS.some((r) => f.path.startsWith(r)) || !/\.tsx?$/.test(f.path)) continue;
    const code = f.text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/.*$/gm, "");
    for (const [re, why] of RULES) {
      for (const m of code.matchAll(re)) violations.push(`${f.path}:${lineOf(code, m.index)} ${why}`);
    }
    for (const m of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      if (!ALLOWED_IMPORTS.test(m[1])) violations.push(`${f.path}:${lineOf(code, m.index)} imports ${m[1]}`);
    }
  }
  return violations;
}

export const fixtures = [
  { path: "packages/engine/src/bad/clock.ts", text: "export const now = () => Date.now();\n" },
  {
    path: "packages/engine/src/bad/net.ts",
    text: 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
  },
  { path: "packages/spending/src/bad/env.ts", text: "export const k = process.env.KEY;\n" },
  { path: "packages/engine/src/bad/rand.ts", text: "export const r = Math.random();\n" },
  { path: "packages/engine/src/bad/dep.ts", text: 'import x from "lodash";\nexport default x;\n' },
];
