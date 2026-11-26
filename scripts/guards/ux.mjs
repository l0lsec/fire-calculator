// UX ratchet (docs/UX_PRINCIPLES.md). Counts known UX debt per file under
// apps/web/src and compares it with scripts/guards/ux-baseline.json:
//   - a count above the baseline fails: new debt is blocked;
//   - a count below the baseline also fails until the baseline is lowered, so
//     every improvement is locked in (`node scripts/guards/ux.mjs --write-baseline`).
// The baseline is never raised by the tool; raising it is a reviewed edit.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lineOf, ROOT } from "./lib.mjs";

export const name = "ux";
const BASELINE = join(ROOT, "scripts/guards/ux-baseline.json");
const IN_SCOPE = /^apps\/web\/src\/.*\.(tsx|ts)$/;

/** Attribute text of every <tag ...> opening, skipping over {...} and quoted strings. */
function openings(text, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let i = m.index + tag.length + 1;
    let depth = 0;
    let quote = "";
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ index: m.index, attrs: text.slice(m.index, i) });
  }
  return out;
}

const PALETTE =
  /\b(?:text|bg|border|ring|fill|stroke)-(?:red|green|blue|yellow|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/** Each rule returns the indexes in the file where it finds debt. */
export const RULES = {
  // Law 14/15: blocking browser dialogs instead of ConfirmDialog and toasts.
  "browser-dialog": (t) =>
    [...t.matchAll(/window\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:confirm|alert)\(/g)].map((m) => m.index),
  // Law 15/19: provider wording on screen instead of explainError.
  "raw-error": (t) =>
    [
      ...t.matchAll(/\.error\.message\b|\(e as Error\)\.message|\berr\.(?:error_message|display_message)\b/g),
    ].map((m) => m.index),
  // Law 2: controls under 40 px.
  // A <summary> is a control too: it needs the same height.
  "small-target": (t) => [
    ...[...t.matchAll(/(?<![\w:-])min-h-[1-9](?![\d.])/g)].map((m) => m.index),
    // Fixed heights under 40 px on a control.
    ...["button", "input", "select"].flatMap((tag) =>
      openings(t, tag)
        .filter((o) => !/type="(?:hidden|checkbox|radio|range)"/.test(o.attrs))
        .filter((o) => /(?<![\w:-])h-[1-9](?![\d.])/.test(o.attrs))
        .map((o) => o.index),
    ),
    ...openings(t, "summary")
      .filter((o) => !/(?<![\w:-])min-h-(?:1\d|[2-9]\d)\b/.test(o.attrs))
      .map((o) => o.index),
  ],
  // Law 12/16: colors outside the design tokens.
  "raw-color": (t) =>
    [...t.matchAll(PALETTE), ...t.matchAll(/(?:className|style)=[^\n]*#[0-9a-fA-F]{3,8}\b/g)].map(
      (m) => m.index,
    ),
  // Law 14: a <button> without type submits forms by accident.
  "button-type": (t) =>
    openings(t, "button")
      .filter((o) => !/\btype=/.test(o.attrs))
      .map((o) => o.index),
  // Accessibility: images need alt text.
  "img-alt": (t) =>
    openings(t, "img")
      .filter((o) => !/\balt=/.test(o.attrs))
      .map((o) => o.index),
};

/** { rule: { path: count } } for the files given. */
export function measure(files) {
  const counts = {};
  for (const rule of Object.keys(RULES)) counts[rule] = {};
  for (const f of files) {
    if (!IN_SCOPE.test(f.path)) continue;
    for (const [rule, find] of Object.entries(RULES)) {
      const n = find(f.text).length;
      if (n) counts[rule][f.path] = n;
    }
  }
  return counts;
}

export function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")).counts ?? {};
  } catch {
    return {};
  }
}

/**
 * Violations against a baseline. Only files in `files` are judged, so a
 * partial scan (the selftest) does not report every other file as improved;
 * a full repository scan (it includes package.json) also reports baseline
 * entries for files that no longer exist.
 */
export function check(files, baseline) {
  const v = [];
  const now = measure(files);
  const present = new Set(files.map((f) => f.path));
  const full = present.has("package.json");
  for (const rule of Object.keys(RULES)) {
    const base = baseline[rule] ?? {};
    for (const f of files) {
      if (!IN_SCOPE.test(f.path)) continue;
      const n = now[rule][f.path] ?? 0;
      const b = base[f.path] ?? 0;
      if (n > b) {
        const first = RULES[rule](f.text)[0] ?? 0;
        v.push(
          `${f.path}:${lineOf(f.text, first)} adds ${rule} debt (${n}, baseline ${b}); see docs/UX_PRINCIPLES.md`,
        );
      } else if (n < b)
        v.push(
          `${f.path} has less ${rule} debt (${n}, baseline ${b}): lower the baseline with node scripts/guards/ux.mjs --write-baseline`,
        );
    }
    if (full)
      for (const [path, b] of Object.entries(base))
        if (b > 0 && !present.has(path))
          v.push(
            `${path} is gone but still has ${rule} baseline ${b}: run node scripts/guards/ux.mjs --write-baseline`,
          );
  }
  return v;
}

export function scan(files) {
  return check(files, loadBaseline());
}

export const fixtures = [
  { path: "apps/web/src/app/fx/confirm.tsx", text: 'if (window.confirm("Delete?")) go();\n' },
  { path: "apps/web/src/app/fx/raw.tsx", text: "setError(res.error.message);\n" },
  { path: "apps/web/src/app/fx/small.tsx", text: '<a className="min-h-8 px-2">x</a>\n' },
  { path: "apps/web/src/app/fx/summary.tsx", text: '<summary className="text-xs">Edit</summary>\n' },
  {
    path: "apps/web/src/app/fx/fixed.tsx",
    text: '<button type="submit" className="h-8 px-2">Set</button>\n',
  },
  { path: "apps/web/src/app/fx/color.tsx", text: '<p className="text-red-500">x</p>\n' },
  { path: "apps/web/src/app/fx/button.tsx", text: "<button onClick={() => go()}>Go</button>\n" },
  { path: "apps/web/src/app/fx/img.tsx", text: '<img src="/x.png" />\n' },
];

// CLI: write the baseline from the current tree, refusing to raise any count.
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--write-baseline")) {
  const { repoFiles } = await import("./lib.mjs");
  const now = measure(repoFiles());
  const old = loadBaseline();
  const allowRaise = process.argv.includes("--allow-raise");
  const raised = [];
  for (const rule of Object.keys(now))
    for (const [path, n] of Object.entries(now[rule]))
      if (n > (old[rule]?.[path] ?? 0)) raised.push(`${rule} ${path}: ${old[rule]?.[path] ?? 0} -> ${n}`);
  if (raised.length && !allowRaise && Object.keys(old).length) {
    console.error(`Refusing to raise the UX baseline (fix the debt instead):\n  ${raised.join("\n  ")}`);
    process.exit(1);
  }
  const counts = Object.fromEntries(
    Object.entries(now).map(([rule, m]) => [rule, Object.fromEntries(Object.entries(m).sort())]),
  );
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ note: "UX debt per file. Lower it as you fix things; never raise it. See scripts/guards/ux.mjs.", counts }, null, 2)}\n`,
  );
  const total = Object.values(counts).reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0);
  console.log(`UX baseline written: ${total} items`);
}
