import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideAccess, isPublic, safeNext } from "../src/lib/auth/access";

function routes() {
  const app = join(__dirname, "../src/app");
  const out: { path: string; api: boolean }[] = [];
  const walk = (dir: string, parts: string[]) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        const seg = /^\(.*\)$/.test(name) ? null : /^\[.*\]$/.test(name) ? "x" : name;
        walk(p, seg === null ? parts : [...parts, seg]);
      } else if (/^page\.tsx?$/.test(name)) out.push({ path: `/${parts.join("/")}`, api: false });
      else if (/^route\.tsx?$/.test(name)) out.push({ path: `/${parts.join("/")}`, api: true });
    }
  };
  walk(app, []);
  return out;
}

describe("access policy", () => {
  it("covers every discovered route", () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(3);
    for (const { path, api } of all) {
      const none = decideAccess(path, null);
      const aal1 = decideAccess(path, "aal1");
      const aal2 = decideAccess(path, "aal2");
      if (isPublic(path)) {
        expect(none.kind, path).toBe("allow");
        continue;
      }
      expect(aal2.kind, path).toBe("allow");
      if (api) {
        expect(none.kind, path).toBe("unauthorized");
        expect(aal1.kind, path).toBe("unauthorized");
      } else if (path === "/mfa") {
        expect(none.kind).toBe("redirect");
        expect(aal1.kind).toBe("allow");
      } else {
        expect(none).toMatchObject({ kind: "redirect" });
        expect(aal1).toMatchObject({ kind: "redirect" });
        if (aal1.kind === "redirect") expect(aal1.to.startsWith("/mfa")).toBe(true);
      }
    }
  });

  it("only honors same-site next paths", () => {
    expect(safeNext("/debts")).toBe("/debts");
    expect(safeNext("//evil.test")).toBe("/dashboard");
    expect(safeNext("https://evil.test")).toBe("/dashboard");
    expect(safeNext("/\\evil.test")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });

  it("does not treat look-alike paths as public", () => {
    expect(isPublic("/sign-inx")).toBe(false);
    expect(isPublic("/api/plaid/webhookx")).toBe(false);
    expect(isPublic("/api/plaid/webhook")).toBe(true);
  });
});
