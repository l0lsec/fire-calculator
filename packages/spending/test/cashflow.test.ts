// Cash-flow forecast: every expected figure below is worked out by hand from
// the history in `household()`, not read back from the code.
import { describe, expect, it } from "vitest";
import {
  buildAlerts,
  type CashAccount,
  type Classified,
  forecastCash,
  nextDue,
  type ScheduledBill,
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
    expect(chk?.shortfall).toEqual({
      date: "2026-12-01",
      cents: -60_000,
      cause: "LANDLORD LLC",
      worstCents: -60_000,
      worstDate: "2026-12-01",
    });
    expect(f.spendable?.safeToSpendCents).toBe(0);
    // By hand: -600 at its deepest on Dec 1, plus groceries of 30 a day for the 6 days to Dec 1 (180),
    // is 780, rounded up to 800. Savings holds 3,000 all month, so it can spare it.
    // Only rent comes out while it is overdrawn: one fee, at the 35 this bank charged before.
    expect(f.transfers).toEqual([
      {
        fromAccountId: "sav",
        toAccountId: "chk",
        cents: 80_000,
        byDate: "2026-11-30",
        coverCents: 60_000,
        paceCents: 20_000,
        worstDate: "2026-12-01",
        sourceLowCents: 300_000,
        sourceLowDate: "2026-11-30",
        sourceFloorCents: 0,
        overdrawn: [
          expect.objectContaining({
            name: "LANDLORD LLC",
            date: "2026-12-01",
            cents: 150_000,
            balanceAfterCents: -60_000,
          }),
        ],
        fee: { perItemCents: 3_500, source: "history", feeIds: expect.any(Array), ownAccount: true },
        feesAvoidedCents: 3_500,
        uncoveredCents: 0,
        coverDays: null,
      },
      // The business account (500 against payroll of 1,000 on Dec 3) is planned after: its week from
      // Dec 3 bottoms out at -500, covered exactly (bills only), from what savings has left.
      expect.objectContaining({ fromAccountId: "sav", toAccountId: "biz", cents: 50_000, coverDays: 7 }),
    ]);
    expect(f.transfers[0]?.fee.feeIds).toHaveLength(2);
    // The business account runs short too (500 against a 1,000 payroll on Dec 3), but stays out of the headline.
    const biz = f.accounts.find((a) => a.account.id === "biz");
    expect(biz?.role).toBe("business");
    expect(biz?.shortfall).toMatchObject({ date: "2026-12-03", cents: -50_000 });
    expect(f.transfers.find((t) => t.toAccountId === "biz")).toMatchObject({
      byDate: "2026-12-02",
      coverCents: 50_000,
      paceCents: 0,
      worstDate: "2026-12-03",
      // Payroll comes out below zero; the fee is the one charged on checking, not this account.
      fee: { perItemCents: 3_500, source: "history", ownAccount: false },
      feesAvoidedCents: 3_500,
    });
    // Fees: one overdraft fee in the last 12 months.
    expect(f.feesCents).toBe(3_500);
  });
});

describe("shortfall depth", () => {
  it("names the first day below zero and the deeper point after it, and covers the deeper one", () => {
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    // A 50 gym fee on Dec 3 lands before Dec 4's pay: -600 on Dec 1, then -650 on Dec 3.
    for (const d of ["2026-09-03", "2026-10-03", "2026-11-03"])
      h.classified.push(
        c("chk", d, 5_000, "PLANET GYM", "living_expense", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"),
      );
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    expect(f.accounts.find((a) => a.account.id === "chk")?.shortfall).toEqual({
      date: "2026-12-01",
      cents: -60_000,
      cause: "LANDLORD LLC",
      worstCents: -65_000,
      worstDate: "2026-12-03",
    });
    // -650 on Dec 3 plus 8 days of groceries at 30 (240) is 890, rounded up to 900; rent and the gym
    // fee both come out below zero, so two fees of 35 are avoided.
    expect(f.transfers[0]).toMatchObject({
      fromAccountId: "sav",
      cents: 90_000,
      byDate: "2026-11-30",
      coverCents: 65_000,
      paceCents: 25_000,
      feesAvoidedCents: 7_000,
    });
    expect(f.transfers[0]?.overdrawn.map((i) => i.name)).toEqual(["LANDLORD LLC", "PLANET GYM"]);
    const alert = buildAlerts({
      asOf: AS_OF,
      recurring: [],
      budgets: [],
      classified: [],
      accounts: [],
      settings: { largeChargeCents: 10_000_000, lowBalanceCents: 0, billLeadDays: 0 },
      cash: f,
    }).find((x) => x.kind === "overdraft-risk");
    expect(alert?.detail).toBe(
      "Bills due before money comes in take it to -$600 (LANDLORD LLC on Dec 1), and to -$650 by Dec 3. Move $900 from Savings by Nov 30 to avoid about $70 in fees.",
    );
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
    expect(risk[0]?.detail).toContain("Move $800 from Savings by Nov 30 to avoid about $35 in fees.");
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

describe("bills added by hand", () => {
  const bill = (b: Partial<ScheduledBill>): ScheduledBill => ({
    id: "b1",
    accountId: "chk",
    name: "LIFE POLICY",
    amountCents: 30_000,
    cadence: "quarterly",
    nextDate: "2026-11-30",
    ...b,
  });

  it("go out on their date and lower safe to spend like any other bill", () => {
    const h = household({ checkingCents: 200_000, groceryCents: 9_000 });
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000, scheduled: [bill({})] });
    // By hand: 2,000 - 100 late phone = 1,900; Nov 30 policy -300 = 1,600; Dec 1 rent -1,500 = 100.
    // The next quarter (Feb 28) is outside the 30 days.
    expect(f.spendable?.low).toEqual({ date: "2026-12-01", cents: 10_000 });
    // 100 is under the 250 cushion, so nothing is safe to spend.
    expect(f.spendable?.maxTodayCents).toBe(0);
    expect(f.spendable?.safeToSpendCents).toBe(0);
    const mine = f.upcoming.filter((i) => i.scheduledId === "b1");
    expect(mine.map((i) => [i.date, i.name, i.deltaCents, i.kind])).toEqual([
      ["2026-11-30", "LIFE POLICY", -30_000, "bill"],
    ]);
    expect(mine[0]?.balanceAfterCents).toBe(160_000);
  });

  it("roll a due date already past forward by the cadence, and repeat monthly ones", () => {
    expect(nextDue({ cadence: "monthly", nextDate: "2026-10-23" }, AS_OF)).toBe("2026-12-23");
    expect(nextDue({ cadence: "monthly", nextDate: AS_OF }, AS_OF)).toBe(AS_OF);
    const h = household({ checkingCents: 200_000, groceryCents: 9_000 });
    const f = forecastCash({
      asOf: AS_OF,
      ...h,
      cushionCents: 0,
      scheduled: [bill({ cadence: "monthly", amountCents: 5_000, nextDate: "2026-10-23" })],
    });
    // Window ends Dec 25: only Dec 23.
    expect(f.upcoming.filter((i) => i.scheduledId).map((i) => i.date)).toEqual(["2026-12-23"]);
  });

  it("are not counted twice once the bank shows the charge", () => {
    const h = household({ checkingCents: 200_000, groceryCents: 9_000 });
    // Already a repeating charge in the history: Verizon's 100 on Dec 24.
    const repeat = bill({
      id: "phone",
      name: "Phone",
      cadence: "monthly",
      amountCents: 10_000,
      nextDate: "2026-12-24",
    });
    // Already posted two days ago for a bill due tomorrow.
    h.classified.push(
      c("chk", "2026-11-24", 4_000, "NEW YORK LIFE", "living_expense", "GENERAL_SERVICES_INSURANCE"),
    );
    const posted = bill({ id: "posted", cadence: "monthly", amountCents: 4_000, nextDate: "2026-11-27" });
    // Pending for a bill due the day after.
    h.pending.push({
      id: "p2",
      accountId: "chk",
      date: "2026-11-27",
      amountCents: 2_000,
      name: "NYL PREMIUM",
      merchant: null,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
      pending: true,
    });
    const pending = bill({ id: "pending", cadence: "monthly", amountCents: 2_000, nextDate: "2026-11-28" });
    // On another account: never in checking's forecast.
    const savings = bill({ id: "sav", accountId: "sav", nextDate: "2026-12-02" });
    const f = forecastCash({
      asOf: AS_OF,
      ...h,
      cushionCents: 0,
      scheduled: [repeat, posted, pending, savings],
    });
    expect(f.upcoming.some((i) => i.scheduledId)).toBe(false);
    // The savings bill is in the savings account's own forecast.
    const sav = f.accounts.find((a) => a.account.id === "sav");
    expect(sav?.items.map((i) => [i.date, i.deltaCents])).toEqual([["2026-12-02", -30_000]]);
  });
});

describe("moving money to avoid overdrafts", () => {
  const short = () => household({ checkingCents: 100_000, groceryCents: 9_000 });
  const second = (balanceCents: number): CashAccount => ({
    id: "chk2",
    name: "Joint",
    mask: "5555",
    type: "depository",
    subtype: "checking",
    business: false,
    balanceCents,
  });

  it("takes from another checking account first, keeping its cushion, then savings for the rest", () => {
    const h = short();
    // Joint checking holds 500 with nothing scheduled: it can spare 500 - 250 cushion = 250.
    h.accounts.push(second(50_000));
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    const toChk = (x: typeof f) => x.transfers.filter((t) => t.toAccountId === "chk");
    expect(toChk(f).map((t) => [t.fromAccountId, t.cents, t.uncoveredCents])).toEqual([["sav", 80_000, 0]]);
    // Savings can cover all of it, but Joint cannot: one move from the account that covers it whole.
    // With 2,000 in Joint, it can (2,000 - 250 = 1,750 to spare) and comes first.
    const rich = short();
    rich.accounts.push(second(200_000));
    const g = forecastCash({ asOf: AS_OF, ...rich, cushionCents: 25_000 });
    expect(toChk(g).map((t) => [t.fromAccountId, t.cents, t.sourceFloorCents])).toEqual([
      ["chk2", 80_000, 25_000],
    ]);
  });

  it("splits the move when no one account can spare it all, and says what is left", () => {
    const h = short();
    const sav = h.accounts.find((a) => a.id === "sav") as CashAccount;
    sav.balanceCents = 30_000;
    h.accounts.push(second(55_000));
    // Joint spares 550 - 250 = 300, savings 300: 600 of the 800 needed, 200 left uncovered.
    // The business account holds 500 but owes payroll of 1,000 on Dec 3, so it has nothing to spare.
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    expect(f.transfers.map((t) => [t.fromAccountId, t.cents, t.uncoveredCents])).toEqual([
      ["chk2", 30_000, 20_000],
      ["sav", 30_000, 20_000],
    ]);
    // By hand: 900 after the phone bill. With Joint's 300 alone, rent leaves 1,200 - 1,500 = -300, still a fee;
    // with savings' 300 too it leaves exactly 0, no fee. So the second move is the one that avoids it.
    expect(f.transfers.map((t) => t.feesAvoidedCents)).toEqual([0, 3_500]);
  });

  it("uses the fee you set, or a typical fee when the history has none", () => {
    const h = short();
    const mine = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000, overdraftFeeCents: 2_900 });
    expect(mine.transfers[0]?.fee).toEqual({ perItemCents: 2_900, source: "yours", feeIds: [] });
    expect(mine.transfers[0]?.feesAvoidedCents).toBe(2_900);
    const clean = short();
    clean.classified = clean.classified.filter((c) => !c.tx.name.startsWith("OVERDRAFT"));
    const typical = forecastCash({ asOf: AS_OF, ...clean, cushionCents: 25_000 });
    expect(typical.transfers[0]?.fee).toEqual({ perItemCents: 3_500, source: "typical", feeIds: [] });
    expect(typical.feesCents).toBe(0);
    expect(typical.feeIds).toEqual([]);
  });

  it("counts at most three fees a day", () => {
    const h = short();
    // Four small bills on Dec 1 after rent: five charges below zero that day, three fees.
    for (const name of ["WATER CO", "GAS CO", "TRASH CO", "ALARM CO"])
      for (const d of ["2026-09-01", "2026-10-01", "2026-11-01"])
        h.classified.push(c("chk", d, 2_000, name, "living_expense", "RENT_AND_UTILITIES_WATER"));
    const f = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 });
    expect(f.transfers[0]?.overdrawn).toHaveLength(3);
    expect(f.transfers[0]?.feesAvoidedCents).toBe(10_500);
  });

  it("counts a move you made until its deposit shows up, then trusts the balance", () => {
    const h = short();
    const move = {
      id: "m1",
      fromAccountId: "sav",
      toAccountId: "chk",
      cents: 80_000,
      date: "2026-11-30",
      createdOn: AS_OF,
    };
    const waiting = forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000, moves: [move] });
    const chk = waiting.accounts.find((a) => a.account.id === "chk");
    // 900 + 800 - 1,500 = 200 on Dec 1: no shortfall and nothing more to move.
    expect(chk?.shortfall).toBeNull();
    expect(chk?.low).toEqual({ date: "2026-12-01", cents: 20_000 });
    expect(waiting.transfers.filter((t) => t.toAccountId === "chk")).toEqual([]);
    expect(waiting.accounts.find((a) => a.account.id === "sav")?.low.cents).toBe(220_000);
    expect(chk?.items.find((i) => i.moveId === "m1")).toMatchObject({
      name: "Move from Savings ...2222",
      date: "2026-11-30",
      deltaCents: 80_000,
    });
    expect(waiting.moves).toEqual([{ ...move, seenTxId: null, counted: true }]);

    // The deposit lands (pending): the available balance already has it, so the move is not counted again.
    const landed = short();
    const chkAcct = landed.accounts.find((a) => a.id === "chk") as CashAccount;
    chkAcct.balanceCents += 80_000;
    landed.pending.push({
      id: "p-move",
      accountId: "chk",
      date: AS_OF,
      amountCents: -80_000,
      name: "Online Transfer from SAV ...2222",
      merchant: null,
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      pending: true,
    });
    const seen = forecastCash({ asOf: AS_OF, ...landed, cushionCents: 25_000, moves: [move] });
    expect(seen.moves).toEqual([{ ...move, seenTxId: "p-move", counted: false }]);
    expect(seen.accounts.find((a) => a.account.id === "chk")?.low.cents).toBe(20_000);
    expect(seen.accounts.find((a) => a.account.id === "chk")?.items.some((i) => i.moveId)).toBe(false);

    // Never seen and more than a week past its date: no longer counted.
    const stale = forecastCash({
      asOf: AS_OF,
      ...short(),
      cushionCents: 25_000,
      moves: [{ ...move, date: "2026-11-10", createdOn: "2026-11-09" }],
    });
    expect(stale.moves).toMatchObject([{ id: "m1", seenTxId: null, counted: false }]);
  });
});

describe("move plan alerts", () => {
  const settings = { largeChargeCents: 10_000_000, lowBalanceCents: 0, billLeadDays: 0 };
  const joint = (balanceCents: number): CashAccount => ({
    id: "chk2",
    name: "Joint",
    mask: "5555",
    type: "depository",
    subtype: "checking",
    business: false,
    balanceCents,
  });
  const alerts = (cash: ReturnType<typeof forecastCash>, asOf = AS_OF) =>
    buildAlerts({ asOf, recurring: [], budgets: [], classified: [], accounts: [], settings, cash });

  it("names every move of a split plan, the fees it avoids and what is still short", () => {
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    (h.accounts.find((a) => a.id === "sav") as CashAccount).balanceCents = 30_000;
    h.accounts.push(joint(55_000));
    const risk = alerts(forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 })).find((a) =>
      a.key.startsWith("overdraft:chk:"),
    );
    // By hand (see "splits the move"): 300 from Joint, 300 from savings, 200 of the 800 left over.
    expect(risk?.detail).toBe(
      "Bills due before money comes in take it to -$600 (LANDLORD LLC on Dec 1). Move $300 from Joint and $300 from Savings by Nov 30 to avoid about $35 in fees. That still leaves it $200 short, so hold off on spending from it.",
    );
  });

  it("warns about a business account short within its week, with its own move", () => {
    // Two days later, the business payroll on Dec 3 is 5 days away.
    const asOf = "2026-11-28";
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    const biz = alerts(forecastCash({ asOf, ...h, cushionCents: 25_000 }), asOf).find((a) =>
      a.key.startsWith("overdraft:biz:"),
    );
    expect(biz).toMatchObject({
      kind: "overdraft-risk",
      severity: "bad",
      title: "Overdraft risk: Business on Dec 3",
    });
    // 500 against 1,000 of payroll: -500, covered exactly; the fee is the 35 charged on checking.
    expect(biz?.detail).toMatch(
      /^Its bills take it to -\$500 \(INTUIT.* on Dec 3\)\. Move \$500 from Savings by Dec 2 to avoid about \$35 in fees\.$/,
    );
  });

  it("does not warn about a business shortfall a week or more away", () => {
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    const all = alerts(forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 }));
    // Dec 3 is 7 days after Nov 26: its plan is still on Safe to spend, but no alert yet.
    expect(all.some((a) => a.key.startsWith("overdraft:biz:"))).toBe(false);
    expect(all.some((a) => a.key.startsWith("overdraft:chk:"))).toBe(true);
  });

  it("says today when the move is due today", () => {
    // On Nov 30 rent is due tomorrow, so the move is due today.
    const asOf = "2026-11-30";
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    const risk = alerts(forecastCash({ asOf, ...h, cushionCents: 25_000 }), asOf).find((a) =>
      a.key.startsWith("overdraft:chk:"),
    );
    expect(risk?.detail).toMatch(/ Move \$[\d,]+ from Savings today to avoid about \$35 in fees\.$/);
  });

  it("says when no account can spare the money", () => {
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    (h.accounts.find((a) => a.id === "sav") as CashAccount).balanceCents = 0;
    const risk = alerts(forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000 })).find((a) =>
      a.key.startsWith("overdraft:chk:"),
    );
    expect(risk?.detail).toMatch(
      /No account can spare the money, so hold off on spending from it until money comes in\.$/,
    );
  });

  it("raises a move that has not shown up two days after its date, once per move", () => {
    const h = household({ checkingCents: 100_000, groceryCents: 9_000 });
    const move = {
      id: "m1",
      fromAccountId: "sav",
      toAccountId: "chk",
      cents: 80_000,
      date: "2026-11-24",
      createdOn: "2026-11-23",
    };
    const late = alerts(forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000, moves: [move] })).filter(
      (a) => a.kind === "move-not-seen",
    );
    expect(late).toEqual([
      {
        key: "move-not-seen:m1",
        kind: "move-not-seen",
        severity: "warn",
        title: "$800 move to Checking not seen yet",
        detail:
          "You marked it moved from Savings for Nov 24, but no deposit of about that amount has shown up. The forecast counts it until Dec 1; if it did not happen, remove it on Safe to spend.",
        date: "2026-11-24",
        amountCents: 80_000,
      },
    ]);
    // One day after its date is too soon to worry.
    const soon = alerts(
      forecastCash({ asOf: AS_OF, ...h, cushionCents: 25_000, moves: [{ ...move, date: "2026-11-25" }] }),
    );
    expect(soon.some((a) => a.kind === "move-not-seen")).toBe(false);
  });
});
