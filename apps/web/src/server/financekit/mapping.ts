// FinanceKit snapshot -> the same account, transaction and debt shapes Plaid
// produces, so spending derivation, transfer matching and the debt planner
// treat an Apple Card exactly like a card connected through a bank.
import type { PlaidAccountValues, PlaidDebtFields, TransactionValues } from "@fire/db";
import { decimalToCents, type Snapshot, type SnapshotAccount, type SnapshotTransaction } from "./format";

export const ID_PREFIX = "fk:";

type Pfc = { primary: string; detailed: string };
const pfc = (detailed: string): Pfc => {
  for (const p of PRIMARIES) if (detailed.startsWith(`${p}_`)) return { primary: p, detailed };
  throw new Error(`unknown category ${detailed}`);
};
const PRIMARIES = [
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "RENT_AND_UTILITIES",
  "HOME_IMPROVEMENT",
  "TRANSPORTATION",
  "ENTERTAINMENT",
  "PERSONAL_CARE",
  "GOVERNMENT_AND_NON_PROFIT",
  "MEDICAL",
  "TRAVEL",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "INCOME",
];

/**
 * Merchant category codes (ISO 18245) to Plaid personal finance categories.
 * Ranges first match wins; codes not listed fall back by their thousands block.
 */
const MCC_RANGES: [number, number, string][] = [
  [3000, 3299, "TRAVEL_FLIGHTS"],
  [3351, 3441, "TRAVEL_RENTAL_CARS"],
  [3500, 3999, "TRAVEL_LODGING"],
  [4011, 4011, "TRANSPORTATION_PUBLIC_TRANSIT"],
  [4111, 4112, "TRANSPORTATION_PUBLIC_TRANSIT"],
  [4121, 4121, "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"],
  [4131, 4131, "TRANSPORTATION_PUBLIC_TRANSIT"],
  [4215, 4215, "GENERAL_SERVICES_POSTAGE_AND_SHIPPING"],
  [4411, 4411, "TRAVEL_OTHER_TRAVEL"],
  [4511, 4511, "TRAVEL_FLIGHTS"],
  [4722, 4722, "TRAVEL_OTHER_TRAVEL"],
  [4784, 4784, "TRANSPORTATION_TOLLS"],
  [4812, 4814, "RENT_AND_UTILITIES_TELEPHONE"],
  [4816, 4816, "RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
  [4829, 4829, "TRANSFER_OUT_OTHER_TRANSFER_OUT"],
  [4899, 4899, "RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
  [4900, 4900, "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
  [5111, 5111, "GENERAL_MERCHANDISE_OFFICE_SUPPLIES"],
  [5200, 5211, "HOME_IMPROVEMENT_HARDWARE"],
  [5251, 5251, "HOME_IMPROVEMENT_HARDWARE"],
  [5261, 5261, "HOME_IMPROVEMENT_HARDWARE"],
  [5300, 5300, "GENERAL_MERCHANDISE_SUPERSTORES"],
  [5309, 5310, "GENERAL_MERCHANDISE_DISCOUNT_STORES"],
  [5311, 5311, "GENERAL_MERCHANDISE_DEPARTMENT_STORES"],
  [5331, 5331, "GENERAL_MERCHANDISE_DISCOUNT_STORES"],
  [5411, 5411, "FOOD_AND_DRINK_GROCERIES"],
  [5422, 5462, "FOOD_AND_DRINK_GROCERIES"],
  [5499, 5499, "FOOD_AND_DRINK_GROCERIES"],
  [5541, 5542, "TRANSPORTATION_GAS"],
  [5511, 5599, "GENERAL_SERVICES_AUTOMOTIVE"],
  [5611, 5699, "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES"],
  [5712, 5719, "HOME_IMPROVEMENT_FURNITURE"],
  [5722, 5722, "GENERAL_MERCHANDISE_ELECTRONICS"],
  [5732, 5734, "GENERAL_MERCHANDISE_ELECTRONICS"],
  [5735, 5735, "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  [5812, 5812, "FOOD_AND_DRINK_RESTAURANT"],
  [5813, 5813, "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"],
  [5814, 5814, "FOOD_AND_DRINK_FAST_FOOD"],
  [5815, 5815, "ENTERTAINMENT_TV_AND_MOVIES"],
  [5816, 5816, "ENTERTAINMENT_VIDEO_GAMES"],
  [5817, 5818, "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"],
  [5912, 5912, "MEDICAL_PHARMACIES_AND_SUPPLEMENTS"],
  [5921, 5921, "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"],
  [5940, 5941, "GENERAL_MERCHANDISE_SPORTING_GOODS"],
  [5942, 5942, "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
  [5943, 5943, "GENERAL_MERCHANDISE_OFFICE_SUPPLIES"],
  [5947, 5947, "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES"],
  [5960, 5960, "GENERAL_SERVICES_INSURANCE"],
  [5964, 5969, "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
  [5983, 5983, "TRANSPORTATION_GAS"],
  [5994, 5994, "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
  [5995, 5995, "GENERAL_MERCHANDISE_PET_SUPPLIES"],
  [6010, 6011, "TRANSFER_OUT_WITHDRAWAL"],
  [6051, 6051, "TRANSFER_OUT_OTHER_TRANSFER_OUT"],
  [6300, 6300, "GENERAL_SERVICES_INSURANCE"],
  [7011, 7011, "TRAVEL_LODGING"],
  [7210, 7217, "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING"],
  [7230, 7230, "PERSONAL_CARE_HAIR_AND_BEAUTY"],
  [7298, 7298, "PERSONAL_CARE_HAIR_AND_BEAUTY"],
  [7349, 7349, "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE"],
  [7512, 7519, "TRAVEL_RENTAL_CARS"],
  [7523, 7523, "TRANSPORTATION_PARKING"],
  [7531, 7549, "GENERAL_SERVICES_AUTOMOTIVE"],
  [7832, 7841, "ENTERTAINMENT_TV_AND_MOVIES"],
  [7922, 7994, "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS"],
  [7995, 7995, "ENTERTAINMENT_CASINOS_AND_GAMBLING"],
  [7996, 7996, "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS"],
  [7997, 7997, "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"],
  [7998, 7999, "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS"],
  [8011, 8020, "MEDICAL_PRIMARY_CARE"],
  [8021, 8021, "MEDICAL_DENTAL_CARE"],
  [8031, 8042, "MEDICAL_PRIMARY_CARE"],
  [8043, 8043, "MEDICAL_EYE_CARE"],
  [8044, 8099, "MEDICAL_PRIMARY_CARE"],
  [8211, 8299, "GENERAL_SERVICES_EDUCATION"],
  [8351, 8351, "GENERAL_SERVICES_CHILDCARE"],
  [8398, 8398, "GOVERNMENT_AND_NON_PROFIT_DONATIONS"],
  [8661, 8661, "GOVERNMENT_AND_NON_PROFIT_DONATIONS"],
  [9311, 9311, "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"],
  [9211, 9399, "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES"],
  [9402, 9402, "GENERAL_SERVICES_POSTAGE_AND_SHIPPING"],
];

const MCC_BLOCKS: [number, number, string][] = [
  [1500, 2999, "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE"],
  [4000, 4799, "TRANSPORTATION_OTHER_TRANSPORTATION"],
  [4800, 4999, "RENT_AND_UTILITIES_OTHER_UTILITIES"],
  [5000, 5999, "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"],
  [7000, 7999, "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"],
  [8000, 8999, "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"],
];

export function categoryForMcc(mcc: number | null): Pfc | null {
  if (mcc === null) return null;
  for (const [lo, hi, d] of MCC_RANGES) if (mcc >= lo && mcc <= hi) return pfc(d);
  for (const [lo, hi, d] of MCC_BLOCKS) if (mcc >= lo && mcc <= hi) return pfc(d);
  return null;
}

const MONEY_IN_PAYMENT_TYPES = new Set([
  "transfer",
  "billPayment",
  "deposit",
  "directDeposit",
  "standingOrder",
  "directDebit",
]);

/** Plaid category for one FinanceKit transaction on an account of the given kind. */
export function categoryFor(t: SnapshotTransaction, kind: SnapshotAccount["kind"]): Pfc | null {
  const moneyIn = t.indicator === "credit";
  switch (t.type) {
    case "interest":
      return moneyIn ? pfc("INCOME_INTEREST_EARNED") : pfc("BANK_FEES_INTEREST_CHARGE");
    case "dividend":
      return pfc("INCOME_DIVIDENDS");
    case "fee":
      return moneyIn ? pfc("BANK_FEES_OTHER_BANK_FEES") : pfc("BANK_FEES_OTHER_BANK_FEES");
    case "atm":
    case "withdrawal":
      return moneyIn ? pfc("TRANSFER_IN_ACCOUNT_TRANSFER") : pfc("TRANSFER_OUT_WITHDRAWAL");
    case "refund":
      // Nets against the category it came from (a negative living expense).
      return categoryForMcc(t.mcc);
  }
  if (moneyIn) {
    if (kind === "liability" && (MONEY_IN_PAYMENT_TYPES.has(t.type) || t.mcc === null)) {
      // A payment toward the card: paired with the bank-side debit as a transfer.
      return pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    }
    if (t.type === "adjustment") return pfc("TRANSFER_IN_ACCOUNT_TRANSFER");
    if (kind === "asset")
      return t.type === "deposit" ? pfc("TRANSFER_IN_DEPOSIT") : pfc("TRANSFER_IN_ACCOUNT_TRANSFER");
    return categoryForMcc(t.mcc);
  }
  if (kind === "asset" && (t.type === "billPayment" || t.type === "directDebit")) {
    // Apple Cash or Savings paying a bill (usually the Apple Card itself).
    return pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  }
  if (kind === "asset" && (t.type === "transfer" || t.type === "standingOrder")) {
    // To a bank or to a person: the spending review asks which.
    return pfc("TRANSFER_OUT_OTHER_TRANSFER_OUT");
  }
  return categoryForMcc(t.mcc);
}

function subtypeFor(a: SnapshotAccount): string {
  if (a.kind === "liability") return "credit card";
  const text = `${a.displayName} ${a.description ?? ""}`.toLowerCase();
  if (text.includes("saving")) return "savings";
  if (text.includes("cash")) return "prepaid";
  return "checking";
}

/** Current balance in Plaid's convention: owed on a card, held in a deposit account. */
export function currentCentsFor(snapshot: Snapshot, a: SnapshotAccount): number | null {
  const mine = snapshot.balances
    .filter((b) => b.accountId === a.id)
    .sort((x, y) => y.asOf.localeCompare(x.asOf) || (x.kind === "booked" ? -1 : 1));
  const b = mine[0];
  if (!b) return null;
  const amt = decimalToCents(b.amount);
  if (a.kind === "liability") return b.indicator === "debit" ? amt : -amt;
  return b.indicator === "credit" ? amt : -amt;
}

export function accountValuesFor(snapshot: Snapshot, a: SnapshotAccount): PlaidAccountValues {
  const liability = a.kind === "liability";
  let available: number | null = null;
  const availBal = snapshot.balances
    .filter((b) => b.accountId === a.id && b.kind === "available")
    .sort((x, y) => y.asOf.localeCompare(x.asOf))[0];
  if (availBal) available = decimalToCents(availBal.amount);
  return {
    plaidAccountId: `${ID_PREFIX}${a.id}`,
    name: a.displayName,
    officialName: a.description,
    mask: null,
    type: liability ? "credit" : "depository",
    subtype: subtypeFor(a),
    bucket: liability ? "excluded" : "cash",
    currentCents: currentCentsFor(snapshot, a) ?? 0,
    availableCents: available,
    isoCurrency: a.currency,
  };
}

export function debtFieldsFor(snapshot: Snapshot, a: SnapshotAccount): PlaidDebtFields | null {
  if (a.kind !== "liability") return null;
  const minNext = a.credit?.minimumNext ? decimalToCents(a.credit.minimumNext) / 100 : null;
  // FinanceKit does not report an APR: the debt stays "rate needed" until you enter it.
  return {
    name: a.displayName,
    kind: "credit_card",
    balanceCents: Math.max(0, currentCentsFor(snapshot, a) ?? 0),
    minPaymentRule:
      minNext !== null
        ? { type: "card", floor: Math.min(35, minNext), pct: 0.01 }
        : { type: "card", floor: 35, pct: 0.01 },
  };
}

/** Booked, pending and authorized transactions; rejected and memo entries are dropped. */
export function transactionValuesFor(
  t: SnapshotTransaction,
  kind: SnapshotAccount["kind"],
  accountId: string,
): TransactionValues | null {
  if (t.status === "rejected" || t.status === "memo") return null;
  const cents = decimalToCents(t.amount);
  const c = categoryFor(t, kind);
  return {
    plaidTransactionId: `${ID_PREFIX}${t.id}`,
    accountId,
    postedDate: t.posted ?? t.date,
    authorizedDate: t.date,
    // Plaid convention: positive is money leaving the account.
    amountCents: t.indicator === "debit" ? Math.abs(cents) : -Math.abs(cents),
    name: t.description || t.merchant || "Apple transaction",
    merchant: t.merchant,
    pfcPrimary: c?.primary ?? null,
    pfcDetailed: c?.detailed ?? null,
    pending: t.status !== "booked",
    isoCurrency: t.currency,
  };
}
