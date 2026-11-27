// Every figure built from transactions opens the charges it is made of
// (docs/UX_PRINCIPLES.md, law 19). These tests prove the Bills, Budgets and Safe
// to spend breakdowns add up to their figures, and that each line carries the
// real transactions behind it.
import {
  type Classified,
  detectRecurring,
  forecastCash,
  type RecurringSeries,
  type TxClass,
} from "@fire/spending";
import { describe, expect, it } from "vitest";
import { type Breakdown, evaluateStep } from "../src/lib/breakdown";
import { chargesTotal } from "../src/lib/charges";
import { chargeFinder, isLiving } from "../src/server/charges";
import {
  billsBreakdowns,
  budgetBreakdown,
  monthlyMath,
  safeBreakdown,
} from "../src/server/insights/breakdowns";

const AS_OF = "2026-11-26";
const PRIMARIES = [
  "INCOME",
  "RENT_AND_UTILITIES",
  "ENTERTAINMENT",
  "GENERAL_SERVICES",
  "HOME_IMPROVEMENT",
  "FOOD_AND_DRINK",
];
let n = 0;

function c(
  accountId: string,
  date: string,
  cents: number,
  name: string,
  cls: TxClass,
  detailed: string,
  extra: Partial<Classified> = {},
): Classified {
  return {
    tx: {
      id: `t${++n}`,
      accountId,
      date,
      amountCents: cents,
      name,
      merchant: null,
      pfcPrimary: PRIMARIES.find((p) => detailed.startsWith(p)) ?? "OTHER",
      pfcDetailed: detailed,
      pending: false,
    },
    class: cls,
    essential: false,
    category: detailed,
    reason: "test",
    flags: [],
    transferPairId: null,
    countedCents: cls === "living_expense" ? cents : 0,
    ...extra,
  };
}

const ACCOUNTS = [
  { id: "chk", name: "Checking", mask: "1234" },
  { id: "sav", name: "Savings", mask: null },
];

/** Pay every two weeks, rent and a phone bill monthly, Netflix monthly, a yearly domain, groceries. */
function history(): Classified[] {
  const cl: Classified[] = [];
  for (const d of ["2026-10-09", "2026-10-23", "2026-11-06", "2026-11-20"])
    cl.push(c("chk", d, -200_000, "ACME CORP DES:PAYROLL", "income", "INCOME_SALARY"));
  for (const d of ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"])
    cl.push(c("chk", d, 150_000, "LANDLORD LLC", "living_expense", "RENT_AND_UTILITIES_RENT"));
  for (const d of ["2026-08-24", "2026-09-24", "2026-10-24"])
    cl.push(c("chk", d, 10_000, "VERIZON WIRELESS", "living_expense", "RENT_AND_UTILITIES_TELEPHONE"));
  for (const d of ["2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"])
    cl.push(c("chk", d, 1_549, "NETFLIX.COM", "living_expense", "ENTERTAINMENT_TV_AND_MOVIES"));
  for (const d of ["2024-03-02", "2025-03-02", "2026-03-02"])
    cl.push(c("chk", d, 2_400, "NAMECHEAP", "living_expense", "GENERAL_SERVICES_OTHER"));
  // A sofa spread over 5 years: $2,400 charge, $480 counted.
  cl.push(
    c("chk", "2026-11-03", 240_000, "SOFA WORLD", "living_expense", "HOME_IMPROVEMENT_FURNITURE", {
      countedCents: 48_000,
      reason: "spread over 5 years",
    }),
  );
  // Pending: never listed as a charge behind a posted figure.
  cl.push(
    c("chk", "2026-11-25", 5_000, "CORNER MARKET", "living_expense", "FOOD_AND_DRINK_GROCERIES", {
      tx: {
        id: "pending-1",
        accountId: "chk",
        date: "2026-11-25",
        amountCents: 5_000,
        name: "CORNER MARKET",
        merchant: null,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        pending: true,
      },
    }),
  );
  return cl;
}

/** Every step's lines produce its total (the dev check in the panel, as a test). */
function expectAddsUp(b: Breakdown) {
  for (const s of b.steps) expect(evaluateStep(s)).toBeCloseTo(s.total.value, 2);
}

describe("charge finder", () => {
  const cl = history();
  const find = chargeFinder(cl, ACCOUNTS);

  it("returns a series' charges newest first, with the account named, and skips unknown ids", () => {
    const rent = cl.filter((x) => x.tx.name === "LANDLORD LLC").map((x) => x.tx.id);
    const got = find.byIds([...rent, "gone"]);
    expect(got.map((g) => g.date)).toEqual(["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"]);
    expect(got[0]?.account).toBe("Checking ...1234");
    expect(chargesTotal(got)).toBe(600_000);
  });

  it("lists counted amounts with the reason when they differ, and never a pending charge", () => {
    const living = find.where(isLiving, { counted: true });
    const sofa = living.find((x) => x.name === "SOFA WORLD");
    expect(sofa?.amountCents).toBe(48_000);
    expect(sofa?.note).toBe("$2,400.00 charge; spread over 5 years");
    expect(living.some((x) => x.id === "pending-1")).toBe(false);
    const rent = living.find((x) => x.name === "LANDLORD LLC");
    expect(rent?.note).toBeUndefined();
  });
});

describe("Bills breakdowns", () => {
  const cl = history();
  const find = chargeFinder(cl, ACCOUNTS);
  const all = detectRecurring(cl, AS_OF);
  const active = all.filter((s) => s.active);
  const r = {
    subscriptions: active.filter((s) => s.kind === "subscription"),
    bills: active.filter((s) => s.kind === "bill"),
    inactive: all.filter((s) => !s.active),
    hidden: [] as RecurringSeries[],
    subscriptionMonthlyCents: active
      .filter((s) => s.kind === "subscription")
      .reduce((s, x) => s + x.monthlyCents, 0),
    billMonthlyCents: active.filter((s) => s.kind === "bill").reduce((s, x) => s + x.monthlyCents, 0),
  };
  const b = billsBreakdowns(r, (s) => find.byIds(s.transactionIds));

  it("adds each subscription and bill up to its tile, per month and per year", () => {
    expect(r.subscriptions.length).toBeGreaterThan(0);
    expect(r.bills.length).toBeGreaterThan(0);
    for (const x of [b.subscriptions, b.bills, b["fi-effect"]]) expectAddsUp(x);
    expect(b.subscriptions.steps[0]?.total.value).toBeCloseTo(r.subscriptionMonthlyCents / 100, 2);
    expect(b.bills.steps[1]?.total.value).toBeCloseTo((r.billMonthlyCents * 12) / 100, 2);
    expect(b["fi-effect"].steps[0]?.total.value).toBeCloseTo((r.subscriptionMonthlyCents * 12 * 25) / 100, 2);
  });

  it("gives every line the charges it was found from", () => {
    for (const step of [b.subscriptions.steps[0], b.bills.steps[0]])
      for (const l of step?.lines ?? []) expect(l.charges?.length ?? 0).toBeGreaterThanOrEqual(2);
    const rent = b.bills.steps[0]?.lines.find(
      (l) => l.label.includes("Landlord") || l.label.includes("LANDLORD"),
    );
    expect(rent?.charges?.map((x) => x.amountCents)).toEqual([150_000, 150_000, 150_000, 150_000]);
  });

  it("explains a yearly charge's monthly figure with its arithmetic", () => {
    const domain = all.find((s) => s.cadence === "yearly");
    expect(domain).toBeDefined();
    // $24 a year: 24 × 30.44 ÷ 365.25 = $2.00 a month.
    expect(monthlyMath(domain as RecurringSeries)).toBe(
      "$24.00 every year (the middle of 3 charges); $24.00 × 30.44 days ÷ 365.25 days = $2.00 a month",
    );
  });
});

describe("Budgets breakdown", () => {
  it("adds the budgeted categories' spending and budgets, and lists unbudgeted ones apart", () => {
    const cl = history();
    const find = chargeFinder(cl, ACCOUNTS);
    const month = (cat: string) =>
      find.where((x) => isLiving(x) && x.tx.date.startsWith("2026-11") && x.tx.pfcPrimary === cat);
    const lines = [
      { category: "RENT_AND_UTILITIES", budgetCents: 160_000, spentCents: 150_000 },
      { category: "ENTERTAINMENT", budgetCents: 2_000, spentCents: 1_549 },
      { category: "HOME_IMPROVEMENT", budgetCents: null, spentCents: 240_000 },
    ];
    const b = budgetBreakdown(lines, (x) => x, month, "November 2026");
    expectAddsUp(b);
    expect(b.steps[0]?.total.value).toBe(1_515.49);
    expect(b.steps[1]?.total.value).toBe(1_620);
    expect(b.steps[0]?.lines[0]?.charges?.map((x) => x.name)).toEqual(["LANDLORD LLC"]);
    expect(b.notCounted).toEqual([{ label: "HOME_IMPROVEMENT", value: 2_400, reason: "no budget set" }]);
  });
});

describe("Safe to spend breakdown", () => {
  const cl = history();
  const find = chargeFinder(cl, ACCOUNTS);
  const cash = forecastCash({
    asOf: AS_OF,
    accounts: [
      {
        id: "chk",
        name: "Checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        business: false,
        balanceCents: 300_000,
      },
    ],
    classified: cl,
    pending: [],
    cushionCents: 20_000,
  });
  const b = safeBreakdown(
    cash,
    () => "Checking ...1234",
    (ids) => find.byIds(ids),
  ) as Breakdown;

  it("walks from the balance to the lowest point, the cushion and the daily pace, and every step adds up", () => {
    expect(b).not.toBeNull();
    expectAddsUp(b);
    const sp = cash.spendable;
    expect(b.steps[0]?.total.value).toBeCloseTo((sp?.low.cents ?? 0) / 100, 2);
    expect(b.steps[1]?.total.value).toBeCloseTo(((sp?.low.cents ?? 0) - 20_000) / 100, 2);
    expect(b.steps[2]?.total.value).toBeCloseTo(
      ((sp?.perDayCents ?? 0) * Math.max(1, sp?.daysToPayday ?? 0)) / 100,
      2,
    );
    // Safe to spend is the smaller of the last two totals, never below zero.
    const smaller = Math.max(0, Math.min(b.steps[1]?.total.value ?? 0, b.steps[2]?.total.value ?? 0));
    expect(smaller).toBeCloseTo((sp?.safeToSpendCents ?? 0) / 100, 2);
  });

  it("lets each predicted bill open the past charges it came from", () => {
    const rent = b.steps[0]?.lines.find(
      (l) => l.label.startsWith("Landlord") || l.label.startsWith("LANDLORD"),
    );
    expect(rent?.op).toBe("-");
    expect(rent?.charges?.length).toBe(4);
    expect(rent?.chargesIn).toBe(false);
  });
});
