#!/usr/bin/env node
// UX rollout checks (docs/ux-rollout/gates/*.md). Each mode is a pure function from file
// texts to a list of problems; the CLI runs it on the real files and prints the mode's
// success-only token last. `control` proves every mode can fail on a broken fixture.
//
//   node scripts/verify/ux-check.mjs <principles|claude-md|global|plan|survey|control|no-emdash|ratchet|suites>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
// The owner's main checkout, built from the home directory so no username is committed.
const MAIN_CHECKOUT = join(homedir(), "Development/fire-calculator");
const BRANCH = "claude/ux-design-principles-4482fd";
const EM = String.fromCodePoint(0x2014);

const LAWS = [
  "Reduce Choices per Screen: Hick's Law",
  "Make Targets Large: Fitts's Law",
  "Follow Familiar Patterns: Jakob's Law",
  "Group Related Information: Law of Proximity",
  "Break Content Into Chunks: Miller's Law",
  "Respond Within 400 Milliseconds: Doherty Threshold",
  "Highlight the Primary Action: Von Restorff Effect",
  "Place Key Actions Nearby: Fitts's Law",
  "Put Essentials First: Serial Position Effect",
  "End Flows Memorably: Peak-End Rule",
  "Show Visible Progress: Zeigarnik Effect",
  "Simplify Complex Interfaces: Law of Prägnanz",
  "Use Sensible Defaults: Hick's Law",
  "Prevent Errors Proactively: Postel's Law",
  "Make Errors Recoverable: Postel's Law",
  "Maintain Pattern Consistency: Law of Similarity",
  "Connect Related Elements Visually: Law of Uniform Connectedness",
  "Reduce Task Completion Time: Parkinson's Law",
  "Reveal Complexity Gradually: Tesler's Law",
  "Make Completion Feel Closer: Goal-Gradient Effect",
];

const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(ROOT, p);

function walk(dir, keep) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

// ---- checks (pure) ----

export function checkPrinciples(doc) {
  const problems = [];
  LAWS.forEach((title, i) => {
    if (!doc.includes(`\n## ${i + 1}. ${title}\n`))
      problems.push(`missing verbatim heading "## ${i + 1}. ${title}"`);
  });
  for (const s of ["## Implementation Requirements", "## Status of the shared pieces", "## Checklist"]) {
    if (!doc.includes(s)) problems.push(`missing section "${s}"`);
  }
  const checklist = doc.split("## Checklist")[1]?.split("\n## ")[0] ?? "";
  const items = [...checklist.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
  const want = LAWS.map((_, i) => i + 1);
  if (items.join(",") !== want.join(","))
    problems.push(`checklist items are [${items}], want 1..20 in order`);
  return problems;
}

export function checkClaudeMd(text) {
  const problems = [];
  if (!text.includes("docs/UX_PRINCIPLES.md")) problems.push("CLAUDE.md does not name docs/UX_PRINCIPLES.md");
  if (!/before you design, build or change/i.test(text))
    problems.push("CLAUDE.md does not say to read it before UI work");
  if (!text.includes("scripts/verify/ux-check.mjs"))
    problems.push("CLAUDE.md does not name the ux-check command");
  if (!text.includes("window.confirm("))
    problems.push("CLAUDE.md does not carry the interim no-confirm rule");
  return problems;
}

export function checkGlobal(text, { fileExists = existsSync } = {}) {
  const problems = [];
  const section = text.split("\n## FIRE Planner:")[1]?.split("\n## ")[0];
  if (!section) return ["global CLAUDE.md has no FIRE Planner section"];
  const primary = `${MAIN_CHECKOUT}/docs/UX_PRINCIPLES.md`;
  if (!section.replace(/\s+/g, " ").includes(primary)) problems.push(`section does not name ${primary}`);
  const fallback = section.match(/`(\/[^`]*\.claude\/worktrees\/[^`]*\/docs\/UX_PRINCIPLES\.md)`/)?.[1];
  if (!fallback) problems.push("section has no worktree fallback path");
  else if (!fileExists(primary) && !fileExists(fallback))
    problems.push(`neither ${primary} nor ${fallback} exists`);
  if (!section.includes(`${BRANCH}:docs/UX_PRINCIPLES.md`)) problems.push("section has no branch fallback");
  if (!text.includes("## Insights app: UI work follows")) problems.push("the Insights section is gone");
  if (!text.includes("## Loan servicing app: UI work follows"))
    problems.push("the loan servicing section is gone");
  if (section.includes(EM)) problems.push("the FIRE Planner section contains an em dash");
  return problems;
}

/** Glob prefix up to the first wildcard; two globs overlap when one prefix contains the other. */
const prefix = (g) => g.split("*")[0];
const covers = (glob, path) => (glob.includes("*") ? path.startsWith(prefix(glob)) : path === glob);
const overlap = (a, b) => prefix(a).startsWith(prefix(b)) || prefix(b).startsWith(prefix(a));
const ownsOf = (ledger) =>
  (ledger.match(/^OWNS:\s*(.*)$/m)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function checkPlan(plan, ledgers, uiFiles) {
  const problems = [];
  // every ledger the plan names exists
  for (const m of plan.matchAll(/gates\/([\w.-]+\.md)/g)) {
    if (!(m[1] in ledgers)) problems.push(`plan names gates/${m[1]}, which does not exist`);
  }
  // every leaf in the phase-3 table has its ledger
  const leafIds = [...plan.matchAll(/^\| (3[a-z]) /gm)].map((m) => m[1]);
  if (leafIds.length < 2) problems.push("plan has no phase-3 leaf table");
  const leafFiles = Object.keys(ledgers).filter((n) => n.startsWith("leaf-3"));
  for (const id of leafIds) {
    if (!leafFiles.some((n) => n.startsWith(`leaf-${id}-`))) problems.push(`leaf ${id} has no ledger`);
  }
  // phase-3 leaves own disjoint paths
  for (let i = 0; i < leafFiles.length; i++) {
    for (let j = i + 1; j < leafFiles.length; j++) {
      for (const a of ownsOf(ledgers[leafFiles[i]])) {
        for (const b of ownsOf(ledgers[leafFiles[j]])) {
          if (overlap(a, b)) problems.push(`${leafFiles[i]} (${a}) overlaps ${leafFiles[j]} (${b})`);
        }
      }
    }
  }
  // every UI file has an owner in phase 1 or a phase-3 leaf
  const owners = [...leafFiles, "phase-1-shared.md", "phase-4-flows.md"].flatMap((n) =>
    ledgers[n] ? ownsOf(ledgers[n]) : [],
  );
  for (const f of uiFiles) {
    if (!owners.some((g) => covers(g, f))) problems.push(`no phase owns ${f}`);
  }
  for (const [name, text] of Object.entries(ledgers)) {
    if (!/^- \[[ x]\] G1:/m.test(text)) problems.push(`gates/${name} has no G1`);
  }
  return problems;
}

export function measureSurvey(files) {
  // files: [{path, text}] for .tsx under apps/web/src/app and apps/web/src/components
  const count = (re) => files.reduce((n, f) => n + (f.text.match(re) ?? []).length, 0);
  const layout = files.find((f) => f.path.endsWith("app/(app)/layout.tsx"))?.text ?? "";
  const nav = layout.split("const NAV = [")[1]?.split("] as const")[0] ?? "";
  const navHrefs = [...nav.matchAll(/\["(\/[\w-]+)",/g)].map((m) => m[1]);
  return {
    windowConfirm: count(/window\.confirm\(/g),
    confirmProps: count(/\bconfirm=[{"]/g),
    buttonForms: count(/<ButtonForm\b/g),
    rawErrors: count(/\.error\.message\b/g),
    navItems: navHrefs.length,
    connectionsInNav: navHrefs.filter((h) => h === "/connections").length,
    uiFiles: files.length,
  };
}

export function checkSurvey(plan, measured) {
  const line = plan.match(/<!-- survey: ([^>]*) -->/)?.[1];
  if (!line) return ["plan has no machine-readable survey line"];
  const claimed = Object.fromEntries(
    line
      .trim()
      .split(/\s+/)
      .map((kv) => kv.split("=")),
  );
  const problems = [];
  for (const [k, v] of Object.entries(measured)) {
    if (claimed[k] === undefined) problems.push(`survey line lacks ${k} (measured ${v})`);
    else if (Number(claimed[k]) !== v) problems.push(`plan says ${k}=${claimed[k]}, measured ${v}`);
  }
  // the table must repeat the same numbers the line claims
  const table = {
    windowConfirm: /`window\.confirm\(` call sites[^|]*\| (\d+) \|/,
    confirmProps: /`confirm=` prompts[^|]*\| (\d+) \|/,
    buttonForms: /`ButtonForm` uses[^|]*\| (\d+) \|/,
    rawErrors: /raw provider `error\.message`[^|]*\| (\d+) \|/,
    navItems: /top-level nav entries[^|]*\| (\d+) \|/,
  };
  for (const [k, re] of Object.entries(table)) {
    const n = plan.match(re)?.[1];
    if (Number(n) !== measured[k]) problems.push(`plan table says ${k}=${n}, measured ${measured[k]}`);
  }
  return problems;
}

export function checkNoEmdash(files) {
  return files.filter((f) => f.text.includes(EM)).map((f) => `${f.path} contains an em dash`);
}

// ---- real inputs ----

function uiFileList() {
  const web = walk(join(ROOT, "apps/web/src"), (p) => /\.(tsx|css)$/.test(p));
  const ios = walk(join(ROOT, "ios/FIREPlannerSync/App"), (p) => p.endsWith(".swift"));
  return [...web, ...ios].map(rel);
}

function ledgers() {
  const dir = join(ROOT, "docs/ux-rollout/gates");
  return Object.fromEntries(
    readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => [n, read(join(dir, n))]),
  );
}

// The survey describes the app before the rollout, so it is measured at the
// commit the plan names, not at the working tree (which the rollout changes).
const SURVEY_REV = "4328e00";
function surveyFiles(rev = SURVEY_REV) {
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  return git("ls-tree", "-r", "--name-only", rev, "apps/web/src/app", "apps/web/src/components")
    .split("\n")
    .filter((p) => p.endsWith(".tsx"))
    .map((p) => ({ path: p, text: git("show", `${rev}:${p}`) }));
}

function phase0Files() {
  const paths = [
    "docs/UX_PRINCIPLES.md",
    "CLAUDE.md",
    "scripts/verify/ux-check.mjs",
    ...walk(join(ROOT, "docs/ux-rollout"), (p) => p.endsWith(".md")).map(rel),
  ];
  return paths.map((p) => ({ path: p, text: read(join(ROOT, p)) }));
}

const GLOBAL = join(homedir(), ".claude/CLAUDE.md");
const PLAN = () => read(join(ROOT, "docs/ux-rollout/PLAN.md"));

const MODES = {
  principles: [() => checkPrinciples(read(join(ROOT, "docs/UX_PRINCIPLES.md"))), "UX_PRINCIPLES_OK"],
  "claude-md": [() => checkClaudeMd(read(join(ROOT, "CLAUDE.md"))), "UX_CLAUDE_MD_OK"],
  global: [() => checkGlobal(read(GLOBAL)), "UX_GLOBAL_OK"],
  plan: [() => checkPlan(PLAN(), ledgers(), uiFileList()), "UX_PLAN_OK"],
  survey: [
    () => {
      const m = measureSurvey(surveyFiles());
      console.log(`measured ${JSON.stringify(m)}`);
      return checkSurvey(PLAN(), m);
    },
    "UX_SURVEY_OK",
  ],
  "no-emdash": [() => checkNoEmdash(phase0Files()), "UX_NO_EMDASH_OK"],
  control: [controlProblems, "UX_CONTROL_OK"],
  ratchet: [ratchetProblems, "UX_RATCHET_OK"],
  suites: [suiteProblems, "UX_SUITES_OK"],
};

/** Phase 2 G3: the UX guard fails above and below its baseline and passes at it. */
async function ratchetProblems() {
  const ux = await import("../guards/ux.mjs");
  const problems = [];
  const path = "apps/web/src/app/(app)/fx/page.tsx";
  const two = { path, text: 'window.confirm("a");\nwindow.confirm("b");\n' };
  const at = { "browser-dialog": { [path]: 2 } };
  if (ux.check([two], at).length) problems.push("at baseline: reported a violation");
  const above = ux.check([two], { "browser-dialog": { [path]: 1 } });
  if (!above.some((v) => v.includes("adds browser-dialog debt")))
    problems.push("above baseline: not reported");
  else console.log(`above baseline: ${above[0]}`);
  const below = ux.check([{ path, text: 'window.confirm("a");\n' }], at);
  if (!below.some((v) => v.includes("lower the baseline"))) problems.push("below baseline: not reported");
  else console.log(`below baseline: ${below[0]}`);
  const gone = ux.check([{ path: "package.json", text: "{}" }], at);
  if (!gone.some((v) => v.includes("is gone"))) problems.push("stale baseline entry: not reported");
  // The real tree must be exactly at its baseline.
  const { repoFiles } = await import("../guards/lib.mjs");
  const real = ux.scan(repoFiles());
  if (real.length) problems.push(...real.map((v) => `repo: ${v}`));
  return problems;
}

/** Phase 5 G2: lint, typecheck, unit tests and guards all pass. */
function suiteProblems() {
  const problems = [];
  for (const [cmd, ...args] of [
    ["pnpm", "lint"],
    ["pnpm", "typecheck"],
    ["pnpm", "test"],
    ["pnpm", "guards"],
    ["pnpm", "guards:selftest"],
  ]) {
    try {
      execFileSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
      console.log(`ok: ${cmd} ${args.join(" ")}`);
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").slice(-15).join("\n");
      problems.push(`${cmd} ${args.join(" ")} failed:\n${out}`);
    }
  }
  return problems;
}

/** Each check must report at least one problem on a fixture broken in one known way. */
function controlProblems() {
  const problems = [];
  const expectFail = (label, list) => {
    if (list.length === 0) problems.push(`control "${label}" did not fail`);
    else console.log(`control ${label}: fails as expected (${list[0]})`);
  };
  const doc = read(join(ROOT, "docs/UX_PRINCIPLES.md"));
  expectFail("principles without law 7", checkPrinciples(doc.replace(`## 7. ${LAWS[6]}`, "## 7. Something")));
  expectFail("principles with 19 checklist items", checkPrinciples(doc.replace(/^20\. \*\*/m, "- **")));
  expectFail("claude-md without pointer", checkClaudeMd("# Rules\nNothing about UI.\n"));
  const g = read(GLOBAL);
  expectFail(
    "global without Insights",
    checkGlobal(g.replace("## Insights app: UI work follows", "## Gone")),
  );
  expectFail("global with missing paths", checkGlobal(g, { fileExists: () => false }));
  const plan = PLAN();
  const led = ledgers();
  expectFail("plan naming a missing ledger", checkPlan(`${plan}\nSee gates/nope.md.\n`, led, uiFileList()));
  const clash = { ...led, "leaf-3z-clash.md": "OWNS: apps/web/src/app/(app)/plan/forms.tsx\n- [ ] G1: x\n" };
  expectFail("plan with overlapping OWNS", checkPlan(plan, clash, uiFileList()));
  expectFail(
    "plan with an unowned UI file",
    checkPlan(plan, led, [...uiFileList(), "apps/web/src/new/page.tsx"]),
  );
  const m = measureSurvey(surveyFiles());
  expectFail("survey off by one", checkSurvey(plan, { ...m, buttonForms: m.buttonForms + 1 }));
  expectFail("no-emdash on a dash", checkNoEmdash([{ path: "x.md", text: `a ${EM} b` }]));
  return problems;
}

const mode = process.argv[2];
if (!MODES[mode]) {
  console.error(`usage: ux-check.mjs <${Object.keys(MODES).join("|")}>`);
  process.exit(1);
}
const [run, token] = MODES[mode];
const problems = await run();
if (problems.length) {
  for (const p of problems) console.error(`UX CHECK FAIL (${mode}): ${p}`);
  process.exit(1);
}
console.log(token);
