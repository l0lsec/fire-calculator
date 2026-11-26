// Cash-flow forecast: every expected figure below is worked out by hand from
// the history in `household()`, not read back from the code.
import { describe, expect, it } from "vitest";
import {
  buildAlerts,
  type CashAccount,
  type Classified,
  forecastCash,
  type SpendingTx,
  type TxClass,
  weekOf,
} from "../src";

const AS_OF = "2026-11-26";
let n = 0;

function c(
  accountId: string,
  date: string,
  cents: number,
  name: string,
  cls: TxClass,
  detailed: string,
  flags: Classified["flags"] = [],
): Classified {
  const primary = detailed
    .split("_")
    .slice(0, detailed.startsWith("FOOD_AND_DRINK") ? 3 : 2)
    .join("_");
  return {
    tx: {
      id: `t${++n}`,
      accountId,
      date,
      amountCents: cents,
      name,
      merchant: null,
      pfcPrimary: primary,
      pfcDetailed: detailed,
      pending: false,
    },
    class: cls,
    essential: false,
    category: detailed,
    reason: "test",
    flags,
    transferPairId: null,
    countedCents: 0,
  };
}

const addDays = (d: string, k: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/** Checking with pay, rent, a phone bill, a card payment, Netflix and groceries; savings; a business account. */
function household(opts: { checkingCents: number; groceryCents: number }) {
  const cl: Classified[] = [];
  // Pay: 2,000 every two weeks, last on Nov 20, so next Dec 4 and Dec 18.
  for (const d of ["2026-10-09", "2026-10-23", "2026-11-06", "2026-11-20"])
    cl.push(c("chk", d, -200_000, "ACME CORP DES:PAYROLL", "income", "INCOME_SALARY"));
  // Rent 1,500 on the 1st, so next Dec 1.
  for (const d of ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"])
    cl.push(c("chk", d, 150_000, "LANDLORD LLC", "living_expense", "RENT_AND_UTILITIES_RENT"));
  // Phone 100 on the 24th: Nov 24 has not posted, so it is late and due today; then Dec 24.
  for (const d of ["2026-08-24", "2026-09-24", "2026-10-24"])
    cl.push(c("chk", d, 10_000, "VERIZON WIRELESS", "living_expense", "RENT_AND_UTILITIES_TELEPHONE"));
  // Card payment 400 on the 5th, so next Dec 5.
  for (const d of ["2026-09-05", "2026-10-05", "2026-11-05"])
    cl.push(
      c("chk", d, 40_000, "CAPITAL ONE DES:MOBILE PMT", "transfer", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
    );
  // Netflix 15.49 on the 26th: today's is pending, so it must not be counted again.
  for (const d of ["2026-08-26", "2026-09-26", "2026-10-26"])
    cl.push(c("chk", d, 1_549, "NETFLIX.COM", "living_expense", "ENTERTAINMENT_TV_AND_MOVIES"));
  // Side work paid twice: not yet regular enough to count on.
  for (const d of ["2026-10-10", "2026-11-10"])
    cl.push(c("chk", d, -50_000, "SIDE GIG LLC", "income", "INCOME_OTHER_INCOME"));
  // Groceries every three days for the last 90 days: day-to-day spending, never scheduled.
  for (let age = 1; age <= 88; age += 3)
    cl.push(
      c(
        "chk",
        addDays(AS_OF, -age),
        opts.groceryCents,
        "CORNER GROCER",
        "living_expense",
        "FOOD_AND_DRINK_GROCERIES",
      ),
    );
  // The business pays payroll of 1,000 on the 3rd and holds only 500.
  for (const d of ["2026-09-03", "2026-10-03", "2026-11-03"])
    cl.push(c("biz", d, 100_000, "INTUIT DES:PAYROLL", "living_expense", "BUSINESS_PAYROLL"));
  // One overdraft fee in the last year, one older than a year.
  cl.push(c("chk", "2026-06-02", 3_500, "OVERDRAFT ITEM FEE", "living_expense", "BANK_FEES_OVERDRAFT_FEES"));
  cl.push(c("chk", "2025-10-02", 3_500, "OVERDRAFT ITEM FEE", "living_expense", "BANK_FEES_OVERDRAFT_FEES"));

  const pending: SpendingTx[] = [
    {
      id: "p1",
      accountId: "chk",
      date: AS_OF,
      amountCents: 1_549,
      name: "NETFLIX.COM",
      merchant: null,
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      pending: true,
    },
  ];
  const accounts: CashAccount[] = [
    {
      id: "chk",
      name: "Checking",
      mask: "1111",
      type: "depository",
      subtype: "checking",
      business: false,
      balanceCents: opts.checkingCents,
    },
    {
      id: "sav",
      name: "Savings",
      mask: "2222",
      type: "depository",
      subtype: "savings",
      business: false,
      balanceCents: 300_000,
    },
    {
      id: "biz",
      name: "Business",
      mask: "3333",
      type: "depository",
      subtype: "checking",
      business: true,
      balanceCents: 50_000,
    },
    {
      id: "card",
      name: "Card",
      mask: "4444",
      type: "credit",
      subtype: "credit card",
      business: false,
      balanceCents: -90_000,
    },
  ];
  return { classified: cl, pending, accounts };
}

describe("safe to spend", () => {
  it("is the lowest point of the spending accounts before money comes in, less the cushion", () => {
    const h = household({ checkingCents: 200_000, groceryCents: 9_000 });
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    const sp = f.spendable;
    if (!sp) throw new Error("no spending accounts");
    // Only personal checking is spending money; savings, business and cards are not.
    expect(sp.accountIds).toEqual(["chk"]);
    expect(sp.startCents).toBe(200_000);
    // By hand: 2,000 - 100 (late phone, today) = 1,900; Dec 1 rent -1,500 = 400 (the low);
    // Dec 4 pay +2,000 = 2,400; Dec 5 card -400 = 2,000; Dec 18 pay = 4,000; Dec 24 phone = 3,900.
    expect(sp.low).toEqual({ date: "2026-12-01", cents: 40_000 });
    // Spent in one go today, 400 - 250 cushion = 150 is the most.
    expect(sp.maxTodayCents).toBe(15_000);
    // Spread out, the tightest day is Dec 4 before pay lands: 150 over 9 days = 16.66 a day,
    // so 8 days to payday allow 133.28.
    expect(sp.perDayCents).toBe(1_666);
    expect(sp.safeToSpendCents).toBe(13_328);
    expect(sp.nextPayday).toEqual({ date: "2026-12-04", cents: 200_000, name: "ACME CORP" });
    expect(sp.daysToPayday).toBe(8);
    expect(sp.billsBeforePaydayCents).toBe(160_000);
    expect(sp.days.at(-1)?.committedCents).toBe(390_000);

    const plan = f.upcoming.map((i) => [i.date, i.name, i.deltaCents, i.late]);
    expect(plan).toEqual([
      ["2026-11-26", "VERIZON WIRELESS", -10_000, true],
      ["2026-12-01", "LANDLORD LLC", -150_000, false],
      ["2026-12-04", "ACME CORP", 200_000, false],
      ["2026-12-05", "CAPITAL ONE", -40_000, false],
      ["2026-12-18", "ACME CORP", 200_000, false],
      ["2026-12-24", "VERIZON WIRELESS", -10_000, false],
    ]);
    expect(f.upcoming.find((i) => i.kind === "card-payment")?.name).toBe("CAPITAL ONE");
    expect(f.upcoming.at(-1)?.balanceAfterCents).toBe(390_000);
    // Netflix today is already pending, and the side gig has paid only twice.
    expect(f.upcoming.some((i) => i.name.startsWith("NETFLIX") || i.name.startsWith("SIDE GIG"))).toBe(false);
  });

  it("measures the usual pace of day-to-day spending and when it would run out", () => {
    // Groceries of 90 every three days for 90 days: 30 a day.
    const calm = forecastCash({
      asOf: AS_OF,
      ...household({ checkingCents: 200_000, groceryCents: 9_000 }),
      cushionCents: 0,
    });
    expect(calm.spendable?.paceDailyCents).toBe(3_000);
    expect(calm.spendable?.paceRunsOut).toBeNull();
    // 180 every three days is 60 a day: Dec 2 (day 7) ends at 400 - 7 x 60 = -20.
    const busy = forecastCash({
      asOf: AS_OF,
      ...household({ checkingCents: 200_000, groceryCents: 18_000 }),
      cushionCents: 0,
    });
    expect(busy.spendable?.paceDailyCents).toBe(6_000);
    expect(busy.spendable?.paceRunsOut).toBe("2026-12-02");
  });

  it("finds each account's shortfall and suggests a transfer to cover it", () => {
    const f = forecastCash({
      asOf: AS_OF,
      ...household({ checkingCents: 100_000, groceryCents: 9_000 }),
      cushionCents: 25_000,
    });
    const chk = f.accounts.find((a) => a.account.id === "chk");
    // 1,000 - 100 = 900, then rent 1,500 on Dec 1 leaves -600.
    expect(chk?.shortfall).toEqual({ date: "2026-12-01", cents: -60_000, cause: "LANDLORD LLC" });
    expect(f.spendable?.safeToSpendCents).toBe(0);
    expect(f.transfers).toEqual([
      { fromAccountId: "sav", toAccountId: "chk", cents: 60_000, byDate: "2026-11-30" },
    ]);
    // The business account runs short too (500 against a 1,000 payroll on Dec 3), but stays out of the headline.
    const biz = f.accounts.find((a) => a.account.id === "biz");
    expect(biz?.role).toBe("business");
    expect(biz?.shortfall).toMatchObject({ date: "2026-12-03", cents: -50_000 });
    expect(f.transfers.some((t) => t.toAccountId === "biz")).toBe(false);
    // Fees: one overdraft fee in the last 12 months.
    expect(f.feesCents).toBe(3_500);
  });
});

describe("forecast items", () => {
  it("drops items under a dollar and trims memo text from transfer names", () => {
    const h = household({ checkingCents: 200_000, groceryCents: 9_000 });
    for (const d of ["2026-08-31", "2026-09-30", "2026-10-31"])
      h.classified.push(c("chk", d, -5, "INTEREST CREDIT", "income", "INCOME_INTEREST_EARNED"));
    for (const d of ["2026-09-15", "2026-10-15", "2026-11-15"])
      h.classified.push(
        c(
          "chk",
          d,
          60_000,
          'Zelle payment to HAYLEY B for "Nov"; Conf# T0Z9',
          "transfer",
          "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS",
        ),
      );
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    expect(f.upcoming.some((i) => i.name.startsWith("INTEREST"))).toBe(false);
    expect(f.upcoming.find((i) => i.date === "2026-12-15")).toMatchObject({
      name: "Zelle payment to HAYLEY B",
      deltaCents: -60_000,
      kind: "transfer",
    });
  });
});

describe("cash alerts", () => {
  const settings = { largeChargeCents: 10_000_000, lowBalanceCents: 0, billLeadDays: 0 };
  const alertsFor = (checkingCents: number, groceryCents: number) => {
    const h = household({ checkingCents, groceryCents });
    const cash = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    return buildAlerts({
      asOf: AS_OF,
      recurring: [],
      budgets: [],
      classified: [],
      accounts: [],
      settings,
      cash,
    });
  };

  it("an overdraft risk names the account, the day, the cause and the transfer that covers it", () => {
    const alerts = alertsFor(100_000, 9_000);
    const risk = alerts.filter((a) => a.kind === "overdraft-risk");
    expect(risk).toHaveLength(1);
    expect(risk[0]).toMatchObject({
      key: `overdraft:chk:${weekOf("2026-12-01")}`,
      severity: "bad",
      title: "Overdraft risk: Checking on Dec 1",
    });
    expect(risk[0]?.detail).toContain("LANDLORD LLC on Dec 1");
    expect(risk[0]?.detail).toContain("Move $600 from Savings by Nov 30");
    // A committed shortfall already says it; no pace alert on top.
    expect(alerts.some((a) => a.kind === "spending-pace")).toBe(false);
  });

  it("a spending-pace alert warns when the usual pace runs out within two weeks, keyed by week", () => {
    const alerts = alertsFor(200_000, 18_000);
    const pace = alerts.filter((a) => a.kind === "spending-pace");
    expect(pace).toHaveLength(1);
    expect(pace[0]).toMatchObject({ key: `pace:${weekOf(AS_OF)}`, severity: "warn" });
    expect(pace[0]?.title).toBe("At your usual spending you run short around Dec 2");
    expect(pace[0]?.detail).toContain("until Dec 4: $133.28, about $16.66 a day");
    // A calm month raises neither.
    expect(
      alertsFor(200_000, 9_000).filter((a) => a.kind === "spending-pace" || a.kind === "overdraft-risk"),
    ).toEqual([]);
  });
});
