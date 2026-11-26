import { describe, expect, it } from "vitest";
import {
  budgetReport,
  buildAlerts,
  deriveSpending,
  detectRecurring,
  displayName,
  expectedCents,
  merchantKey,
  monthlyAverages,
  type SpendingTx,
  weekOf,
} from "../src";

const ASOF = "2026-11-20";
let seq = 0;
const PRIMARY =
  /^(FOOD_AND_DRINK|GENERAL_MERCHANDISE|GENERAL_SERVICES|RENT_AND_UTILITIES|BANK_FEES|PERSONAL_CARE|LOAN_PAYMENTS|ENTERTAINMENT|TRANSPORTATION|MEDICAL)_/;
function tx(
  date: string,
  cents: number,
  merchant: string,
  detailed: string,
  over: Partial<SpendingTx> = {},
): SpendingTx {
  return {
    id: `t${++seq}`,
    accountId: "chk",
    date,
    amountCents: cents,
    name: merchant.toUpperCase(),
    merchant,
    pfcPrimary: PRIMARY.exec(detailed)?.[1] ?? null,
    pfcDetailed: detailed,
    pending: false,
    ...over,
  };
}
const monthly = (
  day: string,
  months: string[],
  cents: number | number[],
  merchant: string,
  detailed: string,
) =>
  months.map((m, i) =>
    tx(`${m}-${day}`, Array.isArray(cents) ? (cents[i] as number) : cents, merchant, detailed),
  );
const M6 = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

/** Classify with a window that reaches today (asOf = first day of next month). */
function classify(txs: SpendingTx[]) {
  return deriveSpending({
    asOf: "2026-12-01",
    accounts: [{ id: "chk", type: "depository", subtype: "checking" }],
    transactions: txs,
  }).classified;
}

function fixture() {
  seq = 0;
  return [
    ...monthly("05", M6, 1549, "Netflix", "ENTERTAINMENT_TV_AND_MOVIES"),
    ...monthly("11", M6, [1099, 1099, 1099, 1099, 1099, 1199], "Spotify", "ENTERTAINMENT_MUSIC_AND_AUDIO"),
    ...monthly("02", M6, 299, "Apple", "GENERAL_MERCHANDISE_ELECTRONICS"),
    ...monthly("17", M6.slice(0, 5), 1099, "Apple", "GENERAL_MERCHANDISE_ELECTRONICS"),
    ...monthly(
      "21",
      M6.slice(0, 5),
      [8200, 13400, 11900, 9100, 7600],
      "Con Edison",
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    ),
    tx("2026-10-01", 1799, "Hulu", "ENTERTAINMENT_TV_AND_MOVIES"),
    tx("2026-10-31", 1799, "Hulu", "ENTERTAINMENT_TV_AND_MOVIES"),
    ...monthly(
      "03",
      ["2026-03", "2026-04", "2026-05", "2026-06"],
      4000,
      "Gym",
      "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    ),
    tx("2026-07-04", 2399, "Amazon", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"),
    tx("2026-07-29", 899, "Amazon", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"),
    tx("2026-08-02", 15600, "Amazon", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"),
    tx("2026-10-19", 4300, "Amazon", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"),
    tx("2026-11-18", 82000, "Best Buy", "GENERAL_MERCHANDISE_ELECTRONICS"),
    tx("2026-11-09", 25000, "Whole Foods", "FOOD_AND_DRINK_GROCERIES"),
    tx("2026-11-12", 18000, "Whole Foods", "FOOD_AND_DRINK_GROCERIES"),
  ];
}

describe("recurring", () => {
  const found = detectRecurring(classify(fixture()), ASOF);
  const by = (name: string) => found.filter((s) => s.name === name);

  it("finds steady monthly subscriptions and their next date", () => {
    const [n] = by("Netflix");
    expect(n).toMatchObject({
      cadence: "monthly",
      kind: "subscription",
      typicalCents: 1549,
      confidence: "confirmed",
      active: true,
      isNew: false,
    });
    expect(n?.nextDate).toBe("2026-12-05");
    expect(n?.monthlyCents).toBe(1549);
  });

  it("flags a fixed price that went up, and not a utility whose bill varies", () => {
    expect(by("Spotify")[0]?.priceChangeCents).toBe(100);
    expect(expectedCents(by("Spotify")[0]!)).toBe(1199);
    expect(by("Spotify")[0]?.monthlyCents).toBe(1199);
    expect(expectedCents(by("Netflix")[0]!)).toBe(1549);
    const [u] = by("Con Edison");
    expect(u).toMatchObject({ kind: "bill", variable: true, priceChangeCents: 0 });
  });

  it("splits one merchant's two plans, and ignores irregular shopping", () => {
    expect(
      by("Apple")
        .map((s) => s.typicalCents)
        .sort(),
    ).toEqual([1099, 299]);
    expect(by("Amazon")).toHaveLength(0);
    expect(by("Whole Foods")).toHaveLength(0);
  });

  it("two matching charges a month apart are a likely new subscription; a stopped one is inactive", () => {
    expect(by("Hulu")[0]).toMatchObject({ confidence: "likely", isNew: true, active: true });
    expect(by("Gym")[0]).toMatchObject({ active: false });
  });

  it("cleans bank-transfer names and files interest as a bill", () => {
    expect(displayName("AmericanExpress DES:DXXXXX6593 ID: INDN:Someone CO ID:XXXXX9585 WEB", null)).toBe(
      "AmericanExpress",
    );
    const s = detectRecurring(
      classify([
        tx("2026-08-06", 2054, "x", "BANK_FEES_INTEREST_CHARGE", {
          merchant: null,
          name: "INTEREST CHARGED ON PURCHASES",
        }),
        tx("2026-09-06", 2100, "x", "BANK_FEES_INTEREST_CHARGE", {
          merchant: null,
          name: "INTEREST CHARGED ON PURCHASES",
        }),
        tx("2026-10-06", 1980, "x", "BANK_FEES_INTEREST_CHARGE", {
          merchant: null,
          name: "INTEREST CHARGED ON PURCHASES",
        }),
        tx("2025-12-01", 375, "Dairy Queen", "FOOD_AND_DRINK_FAST_FOOD"),
        tx("2026-11-17", 375, "Dairy Queen", "FOOD_AND_DRINK_FAST_FOOD"),
      ]),
      ASOF,
    );
    expect(s.map((x) => [x.name, x.kind])).toEqual([["INTEREST CHARGED ON PURCHASES", "bill"]]);
  });

  it("normalizes merchant text", () => {
    expect(merchantKey("NETFLIX.COM 866-579-7172 CA", null)).toBe(merchantKey("x", "Netflix"));
    expect(merchantKey("POS DEBIT SPOTIFY USA", null)).toBe("spotify usa");
  });
});

describe("budgets", () => {
  it("reports this month's spending against budgets with a projection", () => {
    const classified = classify(fixture());
    const lines = budgetReport({
      classified,
      asOf: ASOF,
      budgets: [
        { category: "FOOD_AND_DRINK", monthlyCents: 40000 },
        { category: "ENTERTAINMENT", monthlyCents: 3000 },
        { category: "PERSONAL_CARE", monthlyCents: 10000 },
      ],
      averages: new Map([
        ["FOOD_AND_DRINK", 60000],
        ["ENTERTAINMENT", 4000],
      ]),
    });
    const food = lines.find((l) => l.category === "FOOD_AND_DRINK")!;
    expect(food).toMatchObject({ spentCents: 43000, status: "over" });
    const ent = lines.find((l) => l.category === "ENTERTAINMENT")!;
    // Netflix 15.49 + Spotify 11.99 = 27.48 spent; 10 of 30 days left at 40/month typical.
    expect(ent.spentCents).toBe(2748);
    expect(ent.projectedCents).toBe(2748 + Math.round(4000 * (10 / 30)));
    expect(ent.status).toBe("near");
    expect(lines.find((l) => l.category === "PERSONAL_CARE")?.status).toBe("under");
    expect(lines[0]?.status).toBe("over");
  });

  it("averages come from the annualized category totals", () => {
    const avg = monthlyAverages({
      byCategory: [
        { category: "A_1", primary: "A", essential: false, totalCents: 120000 },
        { category: "A_2", primary: "A", essential: false, totalCents: 24000 },
      ],
    });
    expect(avg.get("A")).toBe(12000);
  });
});

describe("alerts", () => {
  it("raises new, price, due, large-charge, budget and low-balance alerts with stable keys", () => {
    const classified = classify(fixture());
    const recurring = detectRecurring(classified, ASOF);
    const budgets = budgetReport({
      classified,
      asOf: ASOF,
      budgets: [{ category: "FOOD_AND_DRINK", monthlyCents: 40000 }],
      averages: new Map(),
    });
    const alerts = buildAlerts({
      asOf: ASOF,
      recurring,
      budgets,
      classified,
      accounts: [
        {
          id: "chk",
          name: "Checking",
          type: "depository",
          subtype: "checking",
          currentCents: 30000,
          availableCents: 25000,
        },
        {
          id: "sav",
          name: "Savings",
          type: "depository",
          subtype: "savings",
          currentCents: 900000,
          availableCents: null,
        },
        {
          id: "card",
          name: "Card",
          type: "credit",
          subtype: "credit card",
          currentCents: 10,
          availableCents: 0,
        },
      ],
      settings: { largeChargeCents: 50000, lowBalanceCents: 50000, billLeadDays: 5 },
    });
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain("new-subscription");
    expect(alerts.find((a) => a.kind === "price-increase")?.title).toBe("Spotify went up $1");
    expect(alerts.find((a) => a.kind === "large-charge")?.amountCents).toBe(82000);
    expect(alerts.find((a) => a.kind === "budget-over")?.key).toBe("budget-over:FOOD_AND_DRINK:2026-11");
    expect(alerts.filter((a) => a.kind === "low-balance").map((a) => a.key)).toEqual(["low:chk:2026-W47"]);
    // Due within 5 days of the 20th: Con Edison (21st) and Apple 10.99 (17th? no). Netflix (Dec 5) is not.
    const due = alerts.filter((a) => a.kind === "bill-due").map((a) => a.title);
    expect(due.some((t) => t.startsWith("Con Edison"))).toBe(true);
    expect(due.some((t) => t.startsWith("Netflix"))).toBe(false);
    // The stopped gym raises nothing.
    expect(alerts.some((a) => a.title.includes("Gym"))).toBe(false);
    expect(alerts[0]?.severity).toBe("bad");
  });

  it("ISO weeks", () => {
    expect(weekOf("2026-01-01")).toBe("2026-W01");
    expect(weekOf("2027-01-01")).toBe("2026-W53");
    expect(weekOf("2026-11-20")).toBe("2026-W47");
  });
});
