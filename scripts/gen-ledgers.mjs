#!/usr/bin/env node
// Generates one unlazy ledger per BUILD_PLAN ticket at .unlazy/fire-v1/gates/leaf-<id>.md.
// Existing ledgers are left untouched so recorded evidence is never overwritten.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseTickets } from "./verify-plan.mjs";

const plan = readFileSync(new URL("../BUILD_PLAN.md", import.meta.url), "utf8");
const dir = new URL("../.unlazy/fire-v1/gates/", import.meta.url);
mkdirSync(dir, { recursive: true });
let made = 0;
for (const t of parseTickets(plan)) {
  const file = new URL(`leaf-${t.id.slice(1)}.md`, dir);
  if (existsSync(file)) continue;
  const lines = [`# Gates: ${t.id}`, "", `OWNS: ${t.owns.join(", ")}`, "", `Scope: ${t.deliverable}`, ""];
  for (const g of t.gates) {
    const m = g.text.match(/^(.*?)\s*Check `node ([^`]+)`, expect `([A-Z0-9_]+)`\.?$/);
    if (m) {
      lines.push(
        `- [ ] ${g.id}: ${m[1]}`,
        `  CHECK: node ${m[2]}`,
        `  EXPECT: ${m[3]}`,
        "  EVIDENCE: pending",
        "",
      );
    } else {
      lines.push(`- [ ] ${g.id}: ${g.text}`, "  EVIDENCE: pending", "");
    }
  }
  writeFileSync(file, lines.join("\n"));
  made++;
}
console.log(`ledgers written: ${made}`);
