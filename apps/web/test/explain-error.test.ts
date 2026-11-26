import { describe, expect, it } from "vitest";
import { explainError, KNOWN_CODES } from "@/lib/explain-error";

const RAW = "raw-provider-text-that-must-never-show";

describe("explainError", () => {
  it("gives every known Supabase auth code its own plain sentence", () => {
    for (const code of KNOWN_CODES.auth) {
      const text = explainError({ code, message: RAW }, "auth");
      expect(text).not.toContain(RAW);
      expect(text).not.toBe(explainError({}, "auth"));
      expect(text).toMatch(/[.]$/);
    }
  });

  it("gives every known Plaid code its own plain sentence, in any case and any field", () => {
    for (const code of KNOWN_CODES.plaid) {
      for (const e of [{ error_code: code, error_message: RAW }, { code: code.toLowerCase() }, code]) {
        const text = explainError(e, "plaid");
        expect(text).not.toContain(RAW);
        expect(text).not.toBe(explainError({}, "plaid"));
      }
    }
  });

  it("maps the iPhone sync messages the importer records", () => {
    for (const m of [
      "sync file belongs to an older pairing",
      "sync file did not decrypt (re-pair the iPhone if this persists)",
      "sync file is truncated",
      "sync file has an unexpected shape: amount: expected number",
      "sync file could not be read",
    ]) {
      const text = explainError(m, "iphone");
      expect(text).not.toContain("sync file");
      expect(text).not.toBe(explainError({}, "iphone"));
    }
  });

  it("recognises Supabase errors that come with only a message", () => {
    expect(explainError({ message: "Invalid login credentials" }, "auth")).toMatch(/do not match/);
    expect(explainError({ message: "Invalid TOTP code entered" }, "auth")).toMatch(/6-digit code/);
  });

  it("says the network is the problem when it is", () => {
    expect(explainError(new TypeError("Failed to fetch"), "plaid")).toMatch(/connection/);
  });

  it("never returns the raw message for unknown errors", () => {
    for (const source of ["auth", "plaid", "iphone", "network", "unknown"] as const) {
      const text = explainError({ code: "something_new", message: RAW }, source);
      expect(text).not.toContain(RAW);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(explainError(null)).toMatch(/Something went wrong/);
    expect(explainError(undefined, "auth")).toMatch(/Sign-in/);
  });
});
