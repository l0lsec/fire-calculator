#!/usr/bin/env node
// Verifies BUILD_PLAN.md against the gates in GATES.md.
// Usage: node scripts/verify-plan.mjs <sections|levels|example|tickets|plaid|emdash|selftest>
// Each mode prints its success token only after every assertion passes, and exits 1 otherwise.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = join(root, "BUILD_PLAN.md");
const OWNED = ["BUILD_PLAN.md", "GATES.md", "scripts/verify-plan.mjs"];
const EM_DASH = String.fromCodePoint(0x2014);

// ---------- helpers ----------

function sectionText(plan, headingPrefix) {
  const lines = plan.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${headingPrefix}`));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function subsection(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// ---------- checks (each returns a list of failures) ----------

const REQUIRED_SECTIONS = [
  "1. Product scope",
  "2. Stack",
  "3. Architecture",
  "4. Data model",
  "5. Plaid integration",
  "6. Spending derivation",
  "7. Debt engine",
  "8. FI levels",
  "9. Projection engine",
  "10. Worked example",
  "11. UI",
  "12. Security and privacy",
  "13. Phases and tickets",
  "14. Depth tree and waves",
  "15. Risks",
  "16. Open decisions",
];

export function checkSections(plan) {
  const fails = [];
  for (const s of REQUIRED_SECTIONS) {
    const body = sectionText(plan, s);
    if (body === null) {
      fails.push(`missing section: ${s}`);
      continue;
    }
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < 60) fails.push(`section too thin (${words} words): ${s}`);
  }
  return fails;
}

const LEVELS = [
  { heading: "Lean FI", name: "Lean FI" },
  { heading: "FI (regular)", name: "FI" },
  { heading: "Fat FI", name: "Fat FI" },
  { heading: "Barista FI", name: "Barista FI" },
  { heading: "Coast FI", name: "Coast FI" },
];

export function checkLevels(plan) {
  const fails = [];
  const sec = sectionText(plan, "8. FI levels");
  if (!sec) return ["section 8 missing"];
  for (const lv of LEVELS) {
    const sub = subsection(sec, lv.heading);
    if (!sub) {
      fails.push(`no subsection for ${lv.heading}`);
      continue;
    }
    if (!/\*\*Formula[^*]*:\*\*\s*`[^`]*=[^`]*`/.test(sub)) fails.push(`no formula for ${lv.heading}`);
  }
  const tickets = parseTickets(plan);
  const t15 = tickets.find((t) => t.id === "T1.5");
  if (!t15) return [...fails, "ticket T1.5 missing"];
  const gateText = t15.gates.map((g) => g.text).join("\n");
  for (const lv of LEVELS) {
    const re = lv.name === "FI" ? /(^|[^A-Za-z])FI([^A-Za-z]|$)/ : new RegExp(lv.name);
    if (!re.test(gateText)) fails.push(`T1.5 gates do not cover ${lv.name}`);
  }
  return fails;
}

function parseExample(plan) {
  const m = plan.match(/```json worked-example\n([\s\S]*?)\n```/);
  if (!m) throw new Error("worked-example block missing");
  return JSON.parse(m[1]);
}

// Independent recomputation. Written separately from any engine code.
function recompute(inp) {
  const fi = inp.annualExpenses / inp.swr;
  const out = {
    leanFI: inp.essentialExpenses / inp.swr,
    fi,
    fatFI: (inp.annualExpenses * inp.fatMultiplier) / inp.swr,
    baristaFI: Math.max(0, inp.annualExpenses - inp.partTimeIncome) / inp.swr,
    coastFIToday: fi / (1 + inp.realReturn) ** (inp.retirementAge - inp.age),
  };
  const mr = (1 + inp.realReturn) ** (1 / 12) - 1;
  const yearsLeft = inp.retirementAge - inp.age;
  let p = inp.portfolio;
  let k = 0;
  while (p < fi / (1 + inp.realReturn) ** (yearsLeft - k / 12)) {
    p = p * (1 + mr) + inp.monthlyContribution;
    k += 1;
    if (k > 1200) throw new Error("coast loop did not terminate");
  }
  out.coastFIMonths = k;
  p = inp.portfolio;
  k = 0;
  while (p < fi) {
    p = p * (1 + mr) + inp.monthlyContribution;
    k += 1;
    if (k > 1200) throw new Error("fi loop");
  }
  out.fiMonths = k;
  out.avalanche = payoff(inp, (a, b) => b.apr - a.apr || a.balance - b.balance);
  out.snowball = payoff(inp, (a, b) => a.balance - b.balance || b.apr - a.apr);
  return out;
}

function payoff(inp, cmp) {
  const ds = inp.debts.map((d) => ({ ...d }));
  const budget = ds.reduce((s, d) => s + d.minPayment, 0) + inp.extraDebtPayment;
  let months = 0;
  let interest = 0;
  const open = () => ds.filter((d) => d.balance > 0.005);
  while (open().length) {
    months += 1;
    if (months > 600) throw new Error("payoff did not terminate");
    let cash = budget;
    for (const d of open()) {
      const i = (d.balance * d.apr) / 12;
      d.balance += i;
      interest += i;
    }
    for (const d of open()) {
      const pay = Math.min(d.minPayment, d.balance);
      d.balance -= pay;
      cash -= pay;
    }
    for (const d of open().sort(cmp)) {
      if (cash <= 0) break;
      const pay = Math.min(cash, d.balance);
      d.balance -= pay;
      cash -= pay;
    }
  }
  return { months, totalInterest: Math.round(interest * 100) / 100 };
}

export function checkExample(plan) {
  const fails = [];
  let ex;
  try {
    ex = parseExample(plan);
  } catch (e) {
    return [String(e.message)];
  }
  const got = recompute(ex.inputs);
  const want = ex.expected;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const pairs = [
    ["leanFI", 0.5],
    ["fi", 0.5],
    ["fatFI", 0.5],
    ["baristaFI", 0.5],
    ["coastFIToday", 0.5],
    ["coastFIMonths", 0],
    ["fiMonths", 0],
  ];
  for (const [k, tol] of pairs) {
    if (typeof want[k] !== "number") {
      fails.push(`expected.${k} missing`);
      continue;
    }
    if (!near(got[k], want[k], tol)) fails.push(`${k}: plan says ${want[k]}, recomputed ${got[k]}`);
  }
  for (const s of ["avalanche", "snowball"]) {
    if (!want[s]) {
      fails.push(`expected.${s} missing`);
      continue;
    }
    if (got[s].months !== want[s].months)
      fails.push(`${s}.months: plan ${want[s].months}, recomputed ${got[s].months}`);
    if (!near(got[s].totalInterest, want[s].totalInterest, 0.01))
      fails.push(`${s}.totalInterest: plan ${want[s].totalInterest}, recomputed ${got[s].totalInterest}`);
  }
  // The prose must quote the same numbers the fixture holds.
  const sec = sectionText(plan, "10. Worked example") ?? "";
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  for (const n of [want.coastFIToday, want.coastFIMonths, want.fiMonths]) {
    if (!sec.includes(fmt(n))) fails.push(`worked-example prose does not quote ${fmt(n)}`);
  }
  const diff = Math.round(want.snowball.totalInterest - want.avalanche.totalInterest);
  if (!sec.includes(`$${diff}`)) fails.push(`prose does not state the interest difference $${diff}`);
  if (fails.length === 0) console.log(`recomputed: ${JSON.stringify(got)}`);
  return fails;
}

export function parseTickets(plan) {
  const lines = plan.split("\n");
  const tickets = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^### (T\d+\.\d+) (.+)$/);
    if (h) {
      cur = { id: h[1], title: h[2], body: [] };
      tickets.push(cur);
      continue;
    }
    if (line.startsWith("### ") || line.startsWith("## ")) {
      cur = null;
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return tickets.map((t) => {
    const body = t.body.join("\n");
    const field = (name) => (body.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, "m")) || [])[1];
    const gates = [...body.matchAll(/^ {2}- (G\d+): (.+)$/gm)].map((m) => ({
      id: m[1],
      text: m[2],
      runnable: /Check `node [^`]+`, expect `[A-Z0-9_]+_VERIFIED`/.test(m[2]),
      manual: /manual/i.test(m[2]),
    }));
    const deps = field("Depends");
    return {
      id: t.id,
      wave: field("Wave") ? Number(field("Wave")) : NaN,
      depends: !deps ? null : deps.trim() === "none" ? [] : deps.split(",").map((s) => s.trim()),
      owns: field("Owns")
        ? field("Owns")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null,
      deliverable: field("Deliverable"),
      gates,
    };
  });
}

function ownPrefix(glob) {
  const star = glob.indexOf("*");
  return star < 0 ? glob : glob.slice(0, star);
}

export function checkTickets(plan) {
  const fails = [];
  const ts = parseTickets(plan);
  if (ts.length < 10) fails.push(`only ${ts.length} tickets parsed`);
  const byId = new Map();
  for (const t of ts) {
    if (byId.has(t.id)) fails.push(`duplicate ticket ${t.id}`);
    byId.set(t.id, t);
    if (!t.depends) fails.push(`${t.id}: no Depends`);
    if (!t.owns || t.owns.length === 0) fails.push(`${t.id}: no Owns`);
    if (!t.deliverable) fails.push(`${t.id}: no Deliverable`);
    if (!Number.isInteger(t.wave)) fails.push(`${t.id}: no Wave`);
    if (!t.gates.some((g) => g.runnable)) fails.push(`${t.id}: no runnable gate with a success token`);
    for (const g of t.gates)
      if (!g.runnable && !g.manual) fails.push(`${t.id}:${g.id} is neither runnable nor marked manual`);
    const tokens = t.gates.filter((g) => g.runnable).map((g) => g.text.match(/expect `([A-Z0-9_]+)`/)[1]);
    if (new Set(tokens).size !== tokens.length) fails.push(`${t.id}: duplicate success tokens`);
  }
  for (const t of ts)
    for (const d of t.depends ?? []) if (!byId.has(d)) fails.push(`${t.id} depends on unknown ${d}`);
  if (fails.length) return fails;

  // Acyclic, and computed wave equals stated wave.
  const wave = new Map();
  const visiting = new Set();
  const compute = (id) => {
    if (wave.has(id)) return wave.get(id);
    if (visiting.has(id)) throw new Error(`dependency cycle through ${id}`);
    visiting.add(id);
    const deps = byId.get(id).depends;
    const w = deps.length === 0 ? 1 : 1 + Math.max(...deps.map(compute));
    visiting.delete(id);
    wave.set(id, w);
    return w;
  };
  try {
    for (const t of ts) compute(t.id);
  } catch (e) {
    return [e.message];
  }
  for (const t of ts)
    if (wave.get(t.id) !== t.wave) fails.push(`${t.id}: stated wave ${t.wave}, computed ${wave.get(t.id)}`);

  // Wave table in section 14 matches.
  const sec14 = sectionText(plan, "14. Depth tree and waves") ?? "";
  const rows = [...sec14.matchAll(/^\| (\d+) \| (T[\d., T]+) \|$/gm)];
  const tableWave = new Map();
  for (const r of rows)
    for (const id of r[2].split(",").map((s) => s.trim())) tableWave.set(id, Number(r[1]));
  for (const t of ts)
    if (tableWave.get(t.id) !== wave.get(t.id))
      fails.push(`${t.id}: wave table says ${tableWave.get(t.id)}, computed ${wave.get(t.id)}`);
  if (tableWave.size !== ts.length)
    fails.push(`wave table lists ${tableWave.size} tickets, plan has ${ts.length}`);

  // Disjoint ownership within a wave.
  const waves = new Map();
  for (const t of ts) {
    const w = wave.get(t.id);
    if (!waves.has(w)) waves.set(w, []);
    waves.get(w).push(t);
  }
  for (const [w, group] of waves) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        for (const a of group[i].owns)
          for (const b of group[j].owns) {
            const pa = ownPrefix(a);
            const pb = ownPrefix(b);
            if (pa.startsWith(pb) || pb.startsWith(pa))
              fails.push(`wave ${w}: ${group[i].id} (${a}) overlaps ${group[j].id} (${b})`);
          }
      }
  }
  if (fails.length === 0)
    console.log(
      `tickets=${ts.length} waves=${waves.size} gates=${ts.reduce((s, t) => s + t.gates.length, 0)}`,
    );
  return fails;
}

const PLAID_TERMS = [
  "/link/token/create",
  "/item/public_token/exchange",
  "/transactions/sync",
  "/liabilities/get",
  "/investments/holdings/get",
  "/accounts/get",
  "/item/remove",
  "/webhook_verification_key/get",
  "SYNC_UPDATES_AVAILABLE",
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
  "NEW_ACCOUNTS_AVAILABLE",
  "HOLDINGS: DEFAULT_UPDATE",
  "LIABILITIES: DEFAULT_UPDATE",
  "Plaid-Verification",
  "request_body_sha256",
];
const SPENDING_RULES = [
  /Credit card payment rule/i,
  /Internal transfer matching/i,
  /Mortgage escrow/i,
  /Investment contributions/i,
  /Debt payments/i,
  /Refunds/i,
];

export function checkPlaid(plan) {
  const fails = [];
  const p5 = sectionText(plan, "5. Plaid integration") ?? "";
  for (const t of PLAID_TERMS) if (!p5.includes(t)) fails.push(`section 5 does not name ${t}`);
  const p6 = sectionText(plan, "6. Spending derivation") ?? "";
  for (const r of SPENDING_RULES) if (!r.test(p6)) fails.push(`section 6 lacks rule ${r}`);
  return fails;
}

export function findEmDashes(text) {
  const hits = [];
  text.split("\n").forEach((l, i) => {
    if (l.includes(EM_DASH)) hits.push(i + 1);
  });
  return hits;
}

function checkEmDash() {
  const fails = [];
  const control = `clean line\nbad ${EM_DASH} line\n`;
  if (findEmDashes(control).join() !== "2") fails.push("detector missed the positive control");
  for (const f of OWNED) {
    const hits = findEmDashes(readFileSync(join(root, f), "utf8"));
    if (hits.length) fails.push(`${f}: em dash on lines ${hits.join(", ")}`);
  }
  return fails;
}

function checkSelftest(plan) {
  const fails = [];
  const expectFail = (label, fn, broken) => {
    if (fn(broken).length === 0) fails.push(`negative control passed but should fail: ${label}`);
  };
  if (checkTickets(plan).length) fails.push("baseline plan fails tickets check");
  if (checkExample(plan).length) fails.push("baseline plan fails example check");
  expectFail("removed Depends", checkTickets, plan.replace("- **Depends:** T1.4\n", ""));
  expectFail(
    "unknown dependency",
    checkTickets,
    plan.replace("- **Depends:** T1.2, T1.3", "- **Depends:** T1.2, T9.9"),
  );
  expectFail(
    "dependency cycle",
    checkTickets,
    plan.replace(
      "- **Depends:** T0.1\n- **Owns:** packages/db/**",
      "- **Depends:** T0.3\n- **Owns:** packages/db/**",
    ),
  );
  expectFail(
    "overlapping owns in one wave",
    checkTickets,
    plan.replace(
      "packages/spending/**, scripts/verify/t32-**",
      "packages/engine/src/debt/x.ts, scripts/verify/t32-**",
    ),
  );
  expectFail(
    "gate without token",
    checkTickets,
    plan.replace("expect `NEGAM_VERIFIED`", "expect `whatever`"),
  );
  expectFail(
    "altered coast figure",
    checkExample,
    plan.replace('"coastFIToday": 382640', '"coastFIToday": 382000'),
  );
  expectFail(
    "altered snowball interest",
    checkExample,
    plan.replace('"totalInterest": 7918.59', '"totalInterest": 7900.00'),
  );
  expectFail(
    "removed Coast FI formula",
    checkLevels,
    plan.replace("**Formula:** `CoastFI(t)", "Formula `CoastFI(t)"),
  );
  expectFail("removed escrow rule", checkPlaid, plan.replace("**Mortgage escrow:**", "**Housing:**"));
  return fails;
}

// ---------- main ----------

const MODES = {
  sections: [checkSections, "SECTIONS_VERIFIED"],
  levels: [checkLevels, "LEVELS_VERIFIED"],
  example: [checkExample, "EXAMPLE_VERIFIED"],
  tickets: [checkTickets, "TICKETS_VERIFIED"],
  plaid: [checkPlaid, "PLAID_VERIFIED"],
  emdash: [checkEmDash, "EMDASH_VERIFIED"],
  selftest: [checkSelftest, "SELFTEST_VERIFIED"],
};

function main() {
  const mode = process.argv[2];
  if (!MODES[mode]) {
    console.error(`usage: verify-plan.mjs <${Object.keys(MODES).join("|")}>`);
    process.exit(2);
  }
  const plan = readFileSync(PLAN_PATH, "utf8");
  const [fn, token] = MODES[mode];
  const fails = fn(plan);
  if (fails.length) {
    for (const f of fails) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log(token);
}

// Run only when executed directly, so other scripts can import the parsers.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
