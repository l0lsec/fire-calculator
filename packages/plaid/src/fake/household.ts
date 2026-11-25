// The fixture household (BUILD_PLAN section 5, "Sandbox fixtures"): one Item at
// one bank with checking, savings, a linked credit card, a mortgage with escrow,
// a student loan, a 401(k), a Roth IRA and a brokerage account, and 13 months
// of activity covering every spending rule in section 6.
//
// Every amount is fixed so the spending golden test can be computed by hand:
// per month on the window (2025-11 .. 2026-10):
//   card:     groceries 650, restaurants 280, gas 160, streaming 25   (= 1115)
//   checking: utilities 210, phone 85, unlinked AMEX payment 300
//             mortgage 2450, student loan 210, savings transfer 500,
//             brokerage contribution 1000, card payment (last month's card spend),
//             paychecks -3250 x 2, interest -12 on savings
// once: 2026-02-14 furniture 4200 (card), 2026-04-20 refund -80 (card),
//       2026-07-01 insurance 1320 (checking)
// outside the window: 2025-10 activity (too old) and 2026-11 (current month,
// including a pending charge).
import type { PlaidAccount, PlaidTransaction } from "../schemas";

export const FIXTURE_AS_OF = "2026-11-25";
export const FIXTURE_INSTITUTION = { id: "ins_fixture", name: "Fixture Bank" };

export interface FixtureData {
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  liabilities: {
    credit: unknown[];
    mortgage: unknown[];
    student: unknown[];
  };
  holdings: unknown[];
  securities: unknown[];
}

const acct = (
  account_id: string,
  name: string,
  type: string,
  subtype: string,
  current: number,
  available: number | null = null,
  mask = "0000",
): PlaidAccount => ({
  account_id,
  name,
  official_name: null,
  mask,
  type,
  subtype,
  balances: { current, available, iso_currency_code: "USD", limit: null },
});

export const FIXTURE_ACCOUNTS: PlaidAccount[] = [
  acct("acc_chk", "Everyday Checking", "depository", "checking", 8400, 8300, "1111"),
  acct("acc_sav", "High Yield Savings", "depository", "savings", 22000, 22000, "2222"),
  acct("acc_card", "Rewards Card", "credit", "credit card", 1850, null, "3333"),
  acct("acc_mtg", "Home Mortgage", "loan", "mortgage", 285000, null, "4444"),
  acct("acc_stu", "Student Loan", "loan", "student", 18000, null, "5555"),
  acct("acc_401k", "Employer 401(k)", "investment", "401k", 64000, null, "6666"),
  acct("acc_roth", "Roth IRA", "investment", "roth", 21000, null, "7777"),
  acct("acc_brk", "Brokerage", "investment", "brokerage", 35000, null, "8888"),
];

const pfc = (primary: string, detailed: string) => ({ primary, detailed, confidence_level: "VERY_HIGH" });

let seq = 0;
function tx(
  account_id: string,
  date: string,
  amount: number,
  name: string,
  primary: string,
  detailed: string,
  extra: Partial<PlaidTransaction> = {},
): PlaidTransaction {
  seq += 1;
  return {
    transaction_id: `tx_${String(seq).padStart(4, "0")}`,
    account_id,
    amount,
    iso_currency_code: "USD",
    date,
    authorized_date: date,
    name,
    merchant_name: name,
    pending: false,
    personal_finance_category: pfc(primary, detailed),
    ...extra,
  };
}

function months(): string[] {
  // 2025-10 (outside), 2025-11 .. 2026-10 (window), 2026-11 (current month)
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const y = 2025 + Math.floor((9 + i) / 12);
    const m = ((9 + i) % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

export const CARD_MONTHLY = 650 + 280 + 160 + 25;

export function fixtureTransactions(): PlaidTransaction[] {
  seq = 0;
  const out: PlaidTransaction[] = [];
  const all = months();
  let prevCardSpend = CARD_MONTHLY; // the month before the first one
  for (const ym of all) {
    const d = (day: number) => `${ym}-${String(day).padStart(2, "0")}`;
    const current = ym === "2026-11";
    // Income
    out.push(tx("acc_chk", d(1), -3250, "ACME PAYROLL", "INCOME", "INCOME_WAGES"));
    out.push(tx("acc_chk", d(15), -3250, "ACME PAYROLL", "INCOME", "INCOME_WAGES"));
    out.push(tx("acc_sav", d(current ? 20 : 28), -12, "INTEREST PAID", "INCOME", "INCOME_INTEREST_EARNED"));
    // Debt payments from checking
    out.push(
      tx("acc_chk", d(1), 2450, "MORTGAGE SERVICER", "LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT"),
    );
    out.push(
      tx(
        "acc_chk",
        d(5),
        210,
        "STUDENT LOAN SERVICER",
        "LOAN_PAYMENTS",
        "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      ),
    );
    // Linked card: payment of last month's spend, both legs
    out.push(
      tx(
        "acc_chk",
        d(3),
        prevCardSpend,
        "REWARDS CARD PAYMENT",
        "LOAN_PAYMENTS",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      ),
    );
    out.push(
      tx(
        "acc_card",
        d(3),
        -prevCardSpend,
        "PAYMENT THANK YOU",
        "LOAN_PAYMENTS",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      ),
    );
    // Unlinked card: cannot be itemized
    out.push(tx("acc_chk", d(8), 300, "AMEX EPAYMENT", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"));
    // Internal transfer to savings, both legs
    out.push(tx("acc_chk", d(20), 500, "TRANSFER TO SAVINGS", "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"));
    out.push(tx("acc_sav", d(20), -500, "TRANSFER FROM CHECKING", "TRANSFER_IN", "TRANSFER_IN_SAVINGS"));
    // Brokerage contribution (the investment side is not in /transactions/sync)
    out.push(
      tx(
        "acc_chk",
        d(21),
        1000,
        "BROKERAGE DEPOSIT",
        "TRANSFER_OUT",
        "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
      ),
    );
    // Bills
    out.push(
      tx("acc_chk", d(10), 210, "CITY POWER", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"),
    );
    out.push(tx("acc_chk", d(12), 85, "MOBILE CO", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE"));
    // Card purchases
    out.push(tx("acc_card", d(6), 650, "FRESH MARKET", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"));
    out.push(tx("acc_card", d(9), 280, "BISTRO", "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"));
    out.push(tx("acc_card", d(11), 160, "FUEL STOP", "TRANSPORTATION", "TRANSPORTATION_GAS"));
    out.push(tx("acc_card", d(14), 25, "STREAMFLIX", "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES"));
    let cardSpend = CARD_MONTHLY;
    if (ym === "2026-02") {
      out.push(
        tx("acc_card", d(14), 4200, "HOME FURNISHINGS CO", "HOME_IMPROVEMENT", "HOME_IMPROVEMENT_FURNITURE"),
      );
      cardSpend += 4200;
    }
    if (ym === "2026-04") {
      out.push(
        tx("acc_card", d(20), -80, "FRESH MARKET REFUND", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      );
      cardSpend -= 80;
    }
    if (ym === "2026-07") {
      out.push(
        tx("acc_chk", d(1), 1320, "HOME INSURANCE CO", "GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE"),
      );
    }
    if (current) {
      out.push(
        tx("acc_card", d(22), 95, "PENDING MARKET", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", {
          pending: true,
        }),
      );
    }
    prevCardSpend = cardSpend;
  }
  return out;
}

export function fixtureData(): FixtureData {
  return {
    accounts: FIXTURE_ACCOUNTS.map((a) => ({ ...a, balances: { ...a.balances } })),
    transactions: fixtureTransactions(),
    liabilities: {
      credit: [
        {
          account_id: "acc_card",
          aprs: [
            {
              apr_percentage: 24.99,
              apr_type: "purchase_apr",
              balance_subject_to_apr: 1850,
              interest_charge_amount: 0,
            },
            {
              apr_percentage: 29.99,
              apr_type: "cash_apr",
              balance_subject_to_apr: 0,
              interest_charge_amount: 0,
            },
          ],
          is_overdue: false,
          last_payment_amount: 1115,
          last_statement_balance: 1850,
          minimum_payment_amount: 40,
          next_payment_due_date: "2026-12-03",
        },
      ],
      mortgage: [
        {
          account_id: "acc_mtg",
          interest_rate: { percentage: 6.125, type: "fixed" },
          next_monthly_payment: 2450,
          maturity_date: "2052-06-01",
          escrow_balance: 3100,
          origination_principal_amount: 320000,
          has_pmi: false,
          loan_term: "30 year",
        },
      ],
      student: [
        {
          account_id: "acc_stu",
          interest_rate_percentage: 5.5,
          minimum_payment_amount: 210,
          expected_payoff_date: "2034-08-05",
          outstanding_interest_amount: 0,
          next_payment_due_date: "2026-12-05",
        },
      ],
    },
    holdings: [
      {
        account_id: "acc_brk",
        security_id: "sec_vti",
        quantity: 100,
        institution_price: 250,
        institution_value: 25000,
        cost_basis: 18000,
      },
      {
        account_id: "acc_brk",
        security_id: "sec_bnd",
        quantity: 140,
        institution_price: 71.43,
        institution_value: 10000,
        cost_basis: 10500,
      },
      {
        account_id: "acc_401k",
        security_id: "sec_tdf",
        quantity: 640,
        institution_price: 100,
        institution_value: 64000,
        cost_basis: null,
      },
      {
        account_id: "acc_roth",
        security_id: "sec_vti",
        quantity: 84,
        institution_price: 250,
        institution_value: 21000,
        cost_basis: 15000,
      },
    ],
    securities: [
      { security_id: "sec_vti", ticker_symbol: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf" },
      { security_id: "sec_bnd", ticker_symbol: "BND", name: "Vanguard Total Bond Market ETF", type: "etf" },
      { security_id: "sec_tdf", ticker_symbol: null, name: "Target Date 2055 Fund", type: "mutual fund" },
    ],
  };
}
