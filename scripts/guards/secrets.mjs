// No credentials in tracked files: private keys, cloud keys, signed JWTs (for
// example Supabase service keys), Plaid secrets and token-encryption keys.
// Fixture strings are assembled at runtime so this file never matches itself.
import { lineOf } from "./lib.mjs";

export const name = "secrets";

const J = "ey" + "J";
const RULES = [
  [new RegExp(`-----BEGIN ${"(RSA |EC |OPENSSH |)"}PRIVATE KEY-----`), "private key"],
  [new RegExp(`${"AK"}IA[0-9A-Z]{16}`), "AWS access key"],
  [new RegExp(`${"sk"}_live_[0-9a-zA-Z]{16,}`), "live API secret"],
  [new RegExp(`${"sb"}_secret_[0-9A-Za-z_-]{16,}`), "Supabase secret key"],
  [new RegExp(`${J}[A-Za-z0-9_-]{15,}\\.${J}[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}`), "signed JWT"],
  [/PLAID_SECRET\s*[=:]\s*["']?[0-9a-f]{20,}/, "Plaid secret"],
  [/TOKEN_ENCRYPTION_KEYS\s*[=:]\s*["']?\d+:[A-Za-z0-9+/]{40,}={0,2}/, "token encryption key"],
];

export function scan(files) {
  const violations = [];
  for (const f of files) {
    if (/(^|\/)\.env(\.|$)/.test(f.path) && !f.path.endsWith(".env.example")) continue;
    for (const [re, why] of RULES) {
      const g = new RegExp(re.source, "g");
      for (const m of f.text.matchAll(g))
        violations.push(`${f.path}:${lineOf(f.text, m.index)} contains a ${why}`);
    }
  }
  return violations;
}

export const fixtures = [
  { path: "apps/web/src/bad-key.ts", text: `const k = "-----BEGIN ${"PRIVATE"} KEY-----";\n` },
  {
    path: "docs/bad.md",
    text: `service key ${J}hbGciOiJIUzI1NiIsInR5.${J}pc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.abcdefghijklmnopqrstuvwxyz012345\n`,
  },
  { path: "ops/bad.sh", text: `export PLAID_SECRET=${"0123456789abcdef"}0123456789abcd\n` },
  { path: "scripts/bad.mjs", text: `const x = "TOKEN_ENCRYPTION_KEYS=1:${"A".repeat(43)}=";\n` },
];
