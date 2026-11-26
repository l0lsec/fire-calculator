import { describe, expect, it } from "vitest";
import { monthName } from "@/lib/format";
import { describeFiMove } from "@/server/plan-effect";

const m = (y: number, mo: number) => y * 12 + (mo - 1);

describe("describeFiMove", () => {
  it("describes every kind of FI date move", () => {
    expect(describeFiMove(m(2041, 3), m(2040, 11))).toBe(
      `FI date moved 4 mo earlier: ${monthName(m(2041, 3))} to ${monthName(m(2040, 11))}.`,
    );
    expect(describeFiMove(m(2040, 1), m(2042, 1))).toBe("FI date moved 2 yr later: Jan 2040 to Jan 2042.");
    expect(describeFiMove(m(2052, 3), m(2049, 11))).toBe(
      "FI date moved 2 yr 4 mo earlier: Mar 2052 to Nov 2049.",
    );
    expect(describeFiMove(m(2040, 1), m(2040, 1))).toBe("FI date unchanged: Jan 2040.");
    expect(describeFiMove(null, m(2045, 6))).toBe("Your FI date is now Jun 2045.");
    expect(describeFiMove(undefined, m(2045, 6))).toBe("Your FI date is now Jun 2045.");
    expect(describeFiMove(m(2045, 6), null)).toBe(
      "FI is no longer reached within the plan (it was Jun 2045).",
    );
    expect(describeFiMove(null, null)).toBe("FI is not reached within the plan yet.");
    // The plan cannot run yet (no people or spending): say nothing about FI.
    expect(describeFiMove(m(2045, 6), undefined)).toBe("");
  });
});

describe("pct", () => {
  it("keeps a zero and trims only decimal zeros", async () => {
    const { pct } = await import("@/lib/format");
    expect(pct(0, 0)).toBe("0%");
    expect(pct(0)).toBe("0%");
    expect(pct(0.1, 0)).toBe("10%");
    expect(pct(0.075)).toBe("7.5%");
    expect(pct(0.04)).toBe("4%");
    expect(pct(0.2499)).toBe("24.99%");
  });
});
