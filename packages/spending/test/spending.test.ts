import { FIXTURE_ACCOUNTS, FIXTURE_AS_OF, fixtureTransactions } from "@fire/plaid/fake";
import { describe, expect, it } from "vitest";
import {
  deriveSpending,
  escrowFromPayment,
  matchTransfers,
  type SpendingAccount,
  type SpendingInput,
  type SpendingTx,
  spendingWindow,
} from "../src";

function fixtureInput(over: Partial<SpendingInput> = {}): SpendingInput {
  return {
    asOf: FIXTURE_AS_OF,
    accounts: FIXTURE_ACCOUNTS.map((a) => ({ id: a.account_id, type: a.type, subtype: a.subtype })),
    transactions: fixtureTransactions().map((t) => ({
      id: t.transaction_id,
      accountId: t.account_id,
      date: t.date,
      amountCents: Math.round(t.amount * 100),
      name: t.name,
      merchant: t.merchant_name ?? null,
      pfcPrimary: t.personal_finance_category?.primary ?? null,
      pfcDetailed: t.personal_finance_category?.detailed ?? null,
      pending: t.pending,
    })),
    ...over,
  };
}

// Mortgage from the fixture liabilities: 285,000 at 6.125% maturing 2052-06, paying 2,450.
const ESCROW = escrowFromPayment({
  monthlyPaymentCents: 245_000,
  balanceCents: 28_500_000,
  apr: 0.06125,
  asOf: FIXTURE_AS_OF,
  maturityDate: "2052-06-01",
});

describe("fixture household golden", () => {
  it("spending equals the hand-computed total with every exclusion applied", () => {
    const s = deriveSpending(fixtureInput({ mortgages: [{ debtId: "mtg", escrowMonthlyCents: ESCROW }] }));
    expect(s.windowStart).toBe("2025-11-01");
    expect(s.windowEnd).toBe("2026-10-31");
    expect(s.monthsOfData).toBe(12);

    // Card purchases 1115 x 12, furniture 4200, refund -80, utilities 210 x 12,
    // phone 85 x 12, unlinked AMEX 300 x 12, insurance 1320.
    const living = 1115 * 12 + 4200 - 80 + 210 * 12 + 85 * 12 + 300 * 12 + 1320;
    expect(living).toBe(25_960);
    expect(s.livingCents).toBe(living * 100);
    // Essential: groceries (650 x 12 - 80 refund), gas 160 x 12, utilities, phone, insurance.
    const essential = 650 * 12 - 80 + 160 * 12 + 210 * 12 + 85 * 12 + 1320;
    expect(s.livingEssentialCents).toBe(essential * 100);
    expect(s.discretionaryCents).toBe((living - essential) * 100);

    // Escrow is included in total spending, carried from the mortgage record.
    expect(ESCROW).toBeGreaterThan(55_000);
    expect(ESCROW).toBeLessThan(65_000);
    expect(s.escrowCents).toBe(ESCROW * 12);
    expect(s.totalCents).toBe(living * 100 + ESCROW * 12);
    expect(s.essentialCents).toBe(essential * 100 + ESCROW * 12);

    // Exclusions, each verified by class.
    const byName = (name: string) => s.classified.filter((c) => c.tx.name === name);
    for (const c of byName("REWARDS CARD PAYMENT")) expect(c.class).toBe("transfer");
    for (const c of byName("PAYMENT THANK YOU")) expect(c.class).toBe("transfer");
    for (const c of byName("TRANSFER TO SAVINGS")) expect(c.class).toBe("transfer");
    for (const c of byName("MORTGAGE SERVICER")) expect(c.class).toBe("debt_payment");
    for (const c of byName("STUDENT LOAN SERVICER")) expect(c.class).toBe("debt_payment");
    for (const c of byName("BROKERAGE DEPOSIT")) expect(c.class).toBe("investment_contribution");
    expect(s.investmentContributionCents).toBe(1000 * 12 * 100);
    expect(s.debtPaymentCents).toBe((2450 + 210) * 12 * 100);
    expect(s.incomeCents).toBe((6500 + 12) * 12 * 100);
    // Pending and out-of-window transactions never appear.
    expect(s.classified.some((c) => c.tx.pending)).toBe(false);
    expect(s.classified.every((c) => c.tx.date >= "2025-11-01" && c.tx.date <= "2026-10-31")).toBe(true);
  });

  it("a payment to an unlinked card counts as spending and is flagged", () => {
    const s = deriveSpending(fixtureInput());
    const amex = s.classified.filter((c) => c.tx.name === "AMEX EPAYMENT");
    expect(amex).toHaveLength(12);
    for (const c of amex) {
      expect(c.class).toBe("living_expense");
      expect(c.flags).toContain("unlinked-card-payment");
      expect(c.countedCents).toBe(30_000);
    }
    expect(s.reviewQueue.filter((r) => r.flag === "unlinked-card-payment")).toHaveLength(12);

    // Once the card is linked (its payment leg appears), the same payment is a transfer.
    const linkedAmex: SpendingTx[] = amex.map((c) => ({
      ...c.tx,
      id: `${c.tx.id}-in`,
      accountId: "acc_amex",
      amountCents: -c.tx.amountCents,
      name: "AMEX PAYMENT RECEIVED",
    }));
    const withCard = fixtureInput();
    withCard.accounts.push({ id: "acc_amex", type: "credit", subtype: "credit card" });
    withCard.transactions.push(...linkedAmex);
    const s2 = deriveSpending(withCard);
    for (const c of s2.classified.filter((x) => x.tx.name === "AMEX EPAYMENT"))
      expect(c.class).toBe("transfer");
    expect(s2.livingCents).toBe(s.livingCents - 300 * 12 * 100);
  });
});

describe("precedence", () => {
  it("user overrides beat rules, and rules beat PFC defaults", () => {
    const base = deriveSpending(fixtureInput());
    const restaurant = base.classified.find((c) => c.tx.name === "BISTRO")!;
    expect(restaurant.essential).toBe(false);

    // Rule: restaurants are essential for this household.
    const ruled = deriveSpending(
      fixtureInput({
        rules: [{ pfcDetailed: "FOOD_AND_DRINK_RESTAURANT", class: "living_expense", essential: true }],
      }),
    );
    expect(ruled.classified.find((c) => c.tx.id === restaurant.tx.id)?.essential).toBe(true);
    expect(ruled.livingEssentialCents).toBe(base.livingEssentialCents + 280 * 12 * 100);

    // Override on one transaction beats the rule.
    const overridden = deriveSpending(
      fixtureInput({
        rules: [{ pfcDetailed: "FOOD_AND_DRINK_RESTAURANT", class: "living_expense", essential: true }],
        overrides: [{ transactionId: restaurant.tx.id, essential: false }],
      }),
    );
    expect(overridden.classified.find((c) => c.tx.id === restaurant.tx.id)?.essential).toBe(false);
    expect(overridden.livingEssentialCents).toBe(ruled.livingEssentialCents - 280 * 100);

    // A rule cannot turn a transfer category into spending; an override can.
    const transfer = base.classified.find((c) => c.tx.name === "TRANSFER TO SAVINGS")!;
    const ruleTry = deriveSpending(
      fixtureInput({
        rules: [{ pfcDetailed: "TRANSFER_OUT_SAVINGS", class: "living_expense", essential: false }],
      }),
    );
    expect(ruleTry.livingCents).toBe(base.livingCents);
    const overrideTry = deriveSpending(
      fixtureInput({ overrides: [{ transactionId: transfer.tx.id, class: "living_expense" }] }),
    );
    expect(overrideTry.livingCents).toBe(base.livingCents + 500 * 100);
  });

  it("one-time handling: flagged, excluded or amortized on request", () => {
    const base = deriveSpending(fixtureInput());
    const furniture = base.classified.find((c) => c.tx.name === "HOME FURNISHINGS CO")!;
    expect(furniture.flags).toContain("one-time-candidate");
    const insurance = base.classified.find((c) => c.tx.name === "HOME INSURANCE CO")!;
    expect(insurance.flags).toContain("one-time-candidate");
    const groceries = base.classified.find((c) => c.tx.name === "FRESH MARKET")!;
    expect(groceries.flags).not.toContain("one-time-candidate");

    const excluded = deriveSpending(
      fixtureInput({ overrides: [{ transactionId: furniture.tx.id, oneTime: true }] }),
    );
    expect(excluded.livingCents).toBe(base.livingCents - 420_000);
    expect(excluded.reviewQueue.some((r) => r.transactionId === furniture.tx.id)).toBe(false);
    const amortized = deriveSpending(
      fixtureInput({ overrides: [{ transactionId: furniture.tx.id, amortizeYears: 4 }] }),
    );
    expect(amortized.livingCents).toBe(base.livingCents - 420_000 + 105_000);
  });
});

describe("mechanics", () => {
  it("annualizes short histories and warns", () => {
    const input = fixtureInput();
    input.transactions = input.transactions.filter((t) => t.date >= "2026-05-01");
    const s = deriveSpending(input);
    expect(s.monthsOfData).toBe(6);
    expect(s.warnings.join(" ")).toMatch(/6 months/);
    const raw = s.classified.reduce((a, c) => a + c.countedCents, 0);
    expect(s.livingCents).toBe(Math.round(raw * 2));
  });

  it("transfer matching requires different accounts, equal amounts, 3 days and a transfer-like leg", () => {
    const t = (
      id: string,
      accountId: string,
      date: string,
      amountCents: number,
      primary: string,
    ): SpendingTx => ({
      id,
      accountId,
      date,
      amountCents,
      name: id,
      merchant: null,
      pfcPrimary: primary,
      pfcDetailed: null,
      pending: false,
    });
    const linked = new Set(["a", "b"]);
    expect(
      matchTransfers(
        [t("1", "a", "2026-01-01", 500, "TRANSFER_OUT"), t("2", "b", "2026-01-03", -500, "TRANSFER_IN")],
        linked,
      ).size,
    ).toBe(2);
    expect(
      matchTransfers(
        [t("1", "a", "2026-01-01", 500, "TRANSFER_OUT"), t("2", "b", "2026-01-06", -500, "TRANSFER_IN")],
        linked,
      ).size,
    ).toBe(0);
    expect(
      matchTransfers(
        [t("1", "a", "2026-01-01", 500, "TRANSFER_OUT"), t("2", "a", "2026-01-01", -500, "TRANSFER_IN")],
        linked,
      ).size,
    ).toBe(0);
    // A purchase and an unrelated deposit of the same amount are not a transfer.
    expect(
      matchTransfers(
        [t("1", "a", "2026-01-01", 2500, "FOOD_AND_DRINK"), t("2", "b", "2026-01-01", -2500, "INCOME")],
        linked,
      ).size,
    ).toBe(0);
  });

  it("the window is the 12 full months before the as-of month", () => {
    expect(spendingWindow("2026-01-10")).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
    expect(spendingWindow("2024-03-01").end).toBe("2024-02-29");
  });
});

describe("payments to your own cards", () => {
  const checking = { id: "chk", type: "depository", subtype: "checking", name: "Checking" };
  const quicksilver = {
    id: "qs",
    type: "credit",
    subtype: "credit card",
    name: "QuicksilverOne",
    institution: "Capital One",
    mask: "6288",
  };
  const discover = {
    id: "disc",
    type: "credit",
    subtype: "credit card",
    name: "Discover it Chrome",
    institution: "Capital One",
    mask: "7341",
  };
  let n = 0;
  const pay = (name: string, cents: number, date = "2026-03-10"): SpendingTx => ({
    id: `p${++n}`,
    accountId: "chk",
    date,
    amountCents: cents,
    name,
    merchant: null,
    pfcPrimary: "LOAN_PAYMENTS",
    pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    pending: false,
  });
  const run = (txs: SpendingTx[], accounts: SpendingAccount[] = [checking, quicksilver, discover]) =>
    deriveSpending({ asOf: "2026-11-26", accounts, transactions: txs });
  const classOf = (s: ReturnType<typeof run>, name: string) =>
    s.classified.filter((c) => c.tx.name === name).map((c) => c.class);

  it("a payment to a linked card is a transfer even when the card's side is missing", () => {
    // The card's history starts later, so its side of these payments never arrives.
    const s = run([
      pay("CAPITAL ONE DES:MOBILE PMT ID:CA064C0FA1BA03", 185_655, "2025-11-19"),
      pay("Online Banking payment to CRD 6288 Confirmation# 1", 5_000),
    ]);
    expect(s.livingCents).toBe(0);
    expect(s.reviewQueue).toHaveLength(0);
    for (const c of s.classified) {
      expect(c.class).toBe("transfer");
      expect(c.reason).toContain("QuicksilverOne ...6288");
    }
  });

  it("a payment to a card that is not linked still counts as spending, flagged", () => {
    const s = run([pay("APPLECARD GSBANK DES:PAYMENT", 20_000)]);
    // March to October is 8 months of data, annualized.
    expect(s.monthsOfData).toBe(8);
    expect(s.livingCents).toBe(20_000 * 1.5);
    expect(s.reviewQueue.map((r) => r.flag)).toEqual(["unlinked-card-payment"]);
    // Once the Apple Card is linked (for example from the iPhone), the same payment is a transfer.
    const linked = run(
      [pay("APPLECARD GSBANK DES:PAYMENT", 20_000)],
      [checking, { id: "ac", type: "credit", subtype: "credit card", name: "Apple Card", mask: null }],
    );
    expect(linked.livingCents).toBe(0);
  });

  it("with a second, unlinked card from the same issuer, the card's digits or amount decide", () => {
    const txs: SpendingTx[] = [];
    for (const m of ["01", "02", "03", "04", "05", "06"]) {
      txs.push(pay("DISCOVER DES:E-PAYMENT ID:7341", 24_500, `2026-${m}-16`));
      txs.push(pay("DISCOVER DES:E-PAYMENT ID:4077", 16_500, `2026-${m}-04`));
    }
    txs.push(pay("DISCOVER CAP ONE DES:CRCARDPMT ID:CA030443B4", 23_400, "2026-08-17"));
    txs.push(pay("DISCOVER CAP ONE DES:CRCARDPMT ID:CA0412388B", 15_900, "2026-08-03"));
    txs.push(pay("DISCOVER CAP ONE DES:CRCARDPMT ID:CA0000000001", 90_000, "2026-09-03"));
    const s = run(txs);
    expect(new Set(classOf(s, "DISCOVER DES:E-PAYMENT ID:7341"))).toEqual(new Set(["transfer"]));
    expect(new Set(classOf(s, "DISCOVER DES:E-PAYMENT ID:4077"))).toEqual(new Set(["living_expense"]));
    // No digits: closest in amount to the linked card's payments, to the unlinked card's, or to neither.
    expect(classOf(s, "DISCOVER CAP ONE DES:CRCARDPMT ID:CA030443B4")).toEqual(["transfer"]);
    expect(classOf(s, "DISCOVER CAP ONE DES:CRCARDPMT ID:CA0412388B")).toEqual(["living_expense"]);
    expect(classOf(s, "DISCOVER CAP ONE DES:CRCARDPMT ID:CA0000000001")).toEqual(["living_expense"]);
    // January to October is 10 months of data, annualized.
    expect(s.livingCents).toBe(Math.round((6 * 16_500 + 15_900 + 90_000) * 1.2));
  });
});

describe("business accounts", () => {
  it("business spending and income stay in the totals and are reported apart", () => {
    let n = 0;
    const tx = (accountId: string, cents: number, primary: string, detailed: string): SpendingTx => ({
      id: `t${++n}`,
      accountId,
      date: "2026-02-10",
      amountCents: cents,
      name: detailed,
      merchant: null,
      pfcPrimary: primary,
      pfcDetailed: detailed,
      pending: false,
    });
    const s = deriveSpending({
      asOf: "2026-11-26",
      accounts: [
        { id: "home", type: "depository", subtype: "checking" },
        { id: "biz", type: "depository", subtype: "checking", business: true },
      ],
      transactions: [
        tx("home", 10_000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
        tx("biz", 40_000, "GENERAL_SERVICES", "GENERAL_SERVICES_CONSULTING_AND_LEGAL"),
        tx("biz", -300_000, "INCOME", "INCOME_OTHER_INCOME"),
        // Moving money from the business to personal checking is neither.
        tx("biz", 50_000, "TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"),
        tx("home", -50_000, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER"),
      ],
    });
    // February to October is 9 months of data, annualized by 12/9.
    const year = (cents: number) => Math.round((cents * 12) / 9);
    expect(s.livingCents).toBe(year(50_000));
    expect(s.businessCents).toBe(year(40_000));
    expect(s.incomeCents).toBe(year(300_000));
    expect(s.businessIncomeCents).toBe(year(300_000));
    expect(s.byAccount).toEqual([
      { accountId: "biz", livingCents: year(40_000) },
      { accountId: "home", livingCents: year(10_000) },
    ]);
  });
});

describe("payroll and business revenue", () => {
  let n = 0;
  const tx = (
    accountId: string,
    cents: number,
    name: string,
    primary: string | null,
    detailed: string | null,
  ): SpendingTx => ({
    id: `r${++n}`,
    accountId,
    date: "2026-02-10",
    amountCents: cents,
    name,
    merchant: null,
    pfcPrimary: primary,
    pfcDetailed: detailed,
    pending: false,
  });
  const accounts: SpendingAccount[] = [
    { id: "home", type: "depository", subtype: "checking" },
    { id: "biz", type: "depository", subtype: "checking", business: true },
  ];
  const s = deriveSpending({
    asOf: "2026-11-26",
    accounts,
    transactions: [
      tx(
        "biz",
        175_878,
        "INTUIT 79252958 DES:PAYROLL ID:17266980 INDN:SHOW UP SHOW OUT",
        "TRANSFER_OUT",
        "TRANSFER_OUT_OTHER_TRANSFER_OUT",
      ),
      tx(
        "biz",
        -250_000,
        "INTUIT 84895043 DES:DEPOSIT ID:XXXX64118",
        "TRANSFER_IN",
        "TRANSFER_IN_OTHER_TRANSFER_IN",
      ),
      tx("biz", -5_000, "RETURN OF POSTED CHECK / ITEM", "TRANSFER_IN", "TRANSFER_IN_OTHER_TRANSFER_IN"),
      tx("home", -700_000, "CliftonLarso-OSV DES:PAYROLL464 ID:1", "INCOME", "INCOME_SALARY"),
      // A deposit from somewhere else into a PERSONAL account stays a transfer.
      tx("home", -100_000, "WIRE TYPE:WIRE IN", "TRANSFER_IN", "TRANSFER_IN_WIRE"),
    ],
  });
  const byName = (prefix: string) => s.classified.find((c) => c.tx.name.startsWith(prefix));

  it("payroll a business runs is a business cost, not a transfer to review", () => {
    const payroll = byName("INTUIT 79252958");
    expect(payroll?.class).toBe("living_expense");
    expect(payroll?.category).toBe("BUSINESS_PAYROLL");
    expect(payroll?.flags).not.toContain("possible-spending");
    // A paycheck landing in personal checking is still income, even though its name says PAYROLL.
    expect(byName("CliftonLarso")?.class).toBe("income");
  });

  it("money into a business account from outside is income; reversals and personal deposits are not", () => {
    expect(byName("INTUIT 84895043")?.class).toBe("income");
    expect(byName("RETURN OF POSTED")?.class).toBe("transfer");
    expect(byName("WIRE TYPE")?.class).toBe("transfer");
    const year = (cents: number) => Math.round((cents * 12) / 9);
    expect(s.incomeCents).toBe(year(950_000));
    expect(s.businessIncomeCents).toBe(year(250_000));
    expect(s.incomeSources).toEqual([
      { name: "CliftonLarso-OSV", cents: year(700_000), business: false },
      { name: "INTUIT", cents: year(250_000), business: true },
    ]);
  });
});
