import { FIXTURE_ACCOUNTS, FIXTURE_AS_OF, fixtureTransactions } from "@fire/plaid/fake";
import { describe, expect, it } from "vitest";
import {
  deriveSpending,
  escrowFromPayment,
  matchTransfers,
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
