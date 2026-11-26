import { describe, expect, it } from "vitest";
import { AssumptionsForm } from "@/server/scenarios";

const base = {
  nominalReturn: "7",
  inflation: "3",
  cashReturn: "4",
  raiseRate: "3",
  swr: "4",
  retirementAge: "65",
  lifeExpectancy: "95",
  emergencyMonths: "6",
  fatMultiplier: "1.5",
  withdrawalTaxRate: "10",
  retireMode: "fi",
  partTimeAnnual: "",
  partTimeHealth: "",
  partTimeUntil: "",
  policy: "payoffAtFI",
  strategy: "avalanche",
  extraMonthly: "0",
  hybridThreshold: "8",
};

describe("AssumptionsForm", () => {
  it("accepts a blank chosen age when stopping at FI (it used to read as 0 and fail)", () => {
    const r = AssumptionsForm.safeParse({ ...base, retireAge: "" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.retireAge).toBeUndefined();
  });

  it("still checks a chosen age that is filled in, in plain words", () => {
    const r = AssumptionsForm.safeParse({ ...base, retireMode: "age", retireAge: "12" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Between 18 and 100");
  });
});
