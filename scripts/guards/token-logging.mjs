// Plaid access tokens and app secrets must never reach a log line, and no real
// token may be committed as a literal.
import { lineOf } from "./lib.mjs";

export const name = "token-logging";

const SOURCE = /^(apps\/web\/src|packages\/(plaid|db)\/src)\/.*\.(ts|tsx)$/;
const LOG_CALL = /\b(console\.(log|info|warn|error|debug)|logger\.(info|warn|error|debug))\s*\(([^;]*)\)/g;
const SENSITIVE_ARG = /(access_?token|accessToken|secret|password|encryption_?key|ciphertext|PLAID_SECRET)/i;
const TOKEN_LITERAL = /["'`](access-(sandbox|production)-[0-9a-f-]{8,})["'`]/g;

export function scan(files) {
  const violations = [];
  for (const f of files) {
    if (SOURCE.test(f.path)) {
      for (const m of f.text.matchAll(LOG_CALL)) {
        if (SENSITIVE_ARG.test(m[4] ?? "")) {
          violations.push(`${f.path}:${lineOf(f.text, m.index)} logs a sensitive value`);
        }
      }
    }
    if (/\.(ts|tsx|js|mjs|json)$/.test(f.path) && !f.path.includes("/test/") && !f.path.startsWith("e2e/")) {
      for (const m of f.text.matchAll(TOKEN_LITERAL)) {
        violations.push(`${f.path}:${lineOf(f.text, m.index)} contains a Plaid token literal`);
      }
    }
  }
  return violations;
}

export const fixtures = [
  { path: "apps/web/src/server/bad.ts", text: "console.log('exchanged', accessToken);\n" },
  { path: "packages/plaid/src/bad.ts", text: "logger.info({ access_token: t });\n" },
  {
    path: "packages/db/src/bad.ts",
    // Built by concatenation so this file does not contain the literal it detects.
    text: `const t = "${"access-"}sandbox-0d1f2e3a-1111-2222-3333-444455556666";\n`,
  },
];
