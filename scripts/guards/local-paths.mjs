// Open-source hygiene: no absolute home-directory paths in tracked files (they
// leak a username and machine layout). Fixtures are assembled at runtime.
import { lineOf } from "./lib.mjs";

export const name = "local-paths";
const HOME = new RegExp(`(${"/Us"}ers|${"/ho"}me)/[A-Za-z0-9._-]+/`, "g");

export function scan(files) {
  const violations = [];
  for (const f of files) {
    for (const m of f.text.matchAll(HOME))
      violations.push(`${f.path}:${lineOf(f.text, m.index)} contains a home-directory path`);
  }
  return violations;
}

export const fixtures = [{ path: "docs/bad.md", text: `see ${"/Us"}ers/someone/project/file.ts\n` }];
