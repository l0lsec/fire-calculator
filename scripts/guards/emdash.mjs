// House rule: the em dash character (U+2014) never appears anywhere in the repo.
// The character is built from its code point so this file never contains it.
import { lineOf } from "./lib.mjs";

export const name = "emdash";
const EM = String.fromCodePoint(0x2014);

export function scan(files) {
  const violations = [];
  for (const f of files) {
    let i = f.text.indexOf(EM);
    while (i >= 0) {
      violations.push(`${f.path}:${lineOf(f.text, i)} contains an em dash`);
      i = f.text.indexOf(EM, i + 1);
    }
  }
  return violations;
}

export const fixtures = [{ path: "docs/bad.md", text: `A sentence ${EM} with a dash.\n` }];
