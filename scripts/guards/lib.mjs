// Shared helpers for repository guards. Each guard exports `scan(files)` where
// files is an array of { path, text }, and returns a list of violation strings.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname;

const TEXT_EXT = /\.(m?[jt]sx?|json|jsonc|md|css|html|sql|toml|ya?ml|txt|example)$/i;

/** Tracked and untracked-but-not-ignored text files, relative to the repo root. */
export function repoFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((p) => TEXT_EXT.test(p) || p.endsWith(".gitignore"))
    .filter((p) => {
      try {
        return statSync(join(ROOT, p)).isFile();
      } catch {
        return false;
      }
    })
    .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
}

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}
