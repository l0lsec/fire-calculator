// Database schema (BUILD_PLAN section 4).
//
// Everything lives in the `fire` schema, which Supabase's REST API does not
// expose. Every table except `households` carries household_id. Money observed
// from banks is integer cents; rates are decimals stored as double precision.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const fire = pgSchema("fire");

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const cents = (name: string) => bigint(name, { mode: "number" });

export const bucketEnum = fire.enum("bucket", ["cash", "taxable", "traditional", "roth", "hsa", "excluded"]);
export const accountSourceEnum = fire.enum("account_source", ["plaid", "manual", "financekit"]);
export const itemStatusEnum = fire.enum("item_status", [
  "healthy",
  "login_required",
  "pending_disconnect",
  "revoked",
  "error",
]);
export const debtKindEnum = fire.enum("debt_kind", [
  "credit_card",
  "student",
  "mortgage",
  "auto",
  "personal",
  "heloc",
  "medical",
  "other",
]);
export const aprSourceEnum = fire.enum("apr_source", ["plaid", "user", "unknown"]);
export const txClassEnum = fire.enum("tx_class", [
  "living_expense",
  "income",
  "transfer",
  "debt_payment",
  "investment_contribution",
  "refund",
  "ignore",
]);

export const households = fire.table("households", {
  id: id(),
  name: text("name").notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const householdMembers = fire.table(
  "household_members",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** Supabase auth user id. A user belongs to exactly one household. */
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("owner"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("household_members_user_uq").on(t.userId)],
);

export const people = fire.table(
  "people",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Engine month index: year * 12 + (month - 1). */
    birthMonth: integer("birth_month").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("people_household_idx").on(t.householdId)],
);

export const plaidItems = fire.table(
  "plaid_items",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    plaidItemId: text("plaid_item_id").notNull(),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    /** The bank's website from Plaid, for "Open your bank"; "" when Plaid has none, null until looked up. */
    institutionUrl: text("institution_url"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: text("access_token_iv").notNull(),
    keyVersion: integer("key_version").notNull(),
    transactionsCursor: text("transactions_cursor"),
    status: itemStatusEnum("status").notNull().default("healthy"),
    errorCode: text("error_code"),
    consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("plaid_items_item_uq").on(t.plaidItemId),
    index("plaid_items_household_idx").on(t.householdId),
  ],
);

export const accounts = fire.table(
  "accounts",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    source: accountSourceEnum("source").notNull(),
    itemId: uuid("item_id").references(() => plaidItems.id, { onDelete: "set null" }),
    plaidAccountId: text("plaid_account_id"),
    name: text("name").notNull(),
    officialName: text("official_name"),
    mask: text("mask"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    bucket: bucketEnum("bucket").notNull(),
    bucketOverridden: boolean("bucket_overridden").notNull().default(false),
    includeInFi: boolean("include_in_fi").notNull().default(true),
    /** A business account: its spending stays in household totals and is also shown apart. */
    business: boolean("business").notNull().default(false),
    currentCents: cents("current_cents").notNull().default(0),
    availableCents: cents("available_cents"),
    costBasisCents: cents("cost_basis_cents"),
    rothBasisCents: cents("roth_basis_cents"),
    isoCurrency: text("iso_currency").notNull().default("USD"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_plaid_account_uq").on(t.plaidAccountId),
    index("accounts_household_idx").on(t.householdId),
  ],
);

export const balanceSnapshots = fire.table(
  "balance_snapshots",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    currentCents: cents("current_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("balance_snapshots_account_day_uq").on(t.accountId, t.asOfDate)],
);

export const holdings = fire.table(
  "holdings",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id").notNull(),
    ticker: text("ticker"),
    name: text("name"),
    securityType: text("security_type"),
    quantity: doublePrecision("quantity").notNull(),
    valueCents: cents("value_cents").notNull(),
    costBasisCents: cents("cost_basis_cents"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("holdings_account_security_uq").on(t.accountId, t.securityId)],
);

export const debts = fire.table(
  "debts",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: debtKindEnum("kind").notNull(),
    balanceCents: cents("balance_cents").notNull(),
    /** Null when unknown: the engine refuses to plan a debt without a rate. */
    apr: doublePrecision("apr"),
    aprSource: aprSourceEnum("apr_source").notNull().default("user"),
    /** Engine MinPaymentRule, zod-validated on read. */
    minPaymentRule: jsonb("min_payment_rule").notNull(),
    promoApr: doublePrecision("promo_apr"),
    promoEndsMonth: integer("promo_ends_month"),
    maturityDate: date("maturity_date", { mode: "string" }),
    escrowMonthlyCents: cents("escrow_monthly_cents").notNull().default(0),
    /** Per field: "plaid" or "user". A sync never overwrites a "user" field. */
    fieldProvenance: jsonb("field_provenance").notNull().default({}),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("debts_account_uq").on(t.accountId), index("debts_household_idx").on(t.householdId)],
);

export const transactions = fire.table(
  "transactions",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    plaidTransactionId: text("plaid_transaction_id").notNull(),
    postedDate: date("posted_date", { mode: "string" }).notNull(),
    authorizedDate: date("authorized_date", { mode: "string" }),
    /** Plaid sign convention: positive is money leaving the account. */
    amountCents: cents("amount_cents").notNull(),
    name: text("name").notNull(),
    merchant: text("merchant"),
    pfcPrimary: text("pfc_primary"),
    pfcDetailed: text("pfc_detailed"),
    pending: boolean("pending").notNull().default(false),
    transferPairId: uuid("transfer_pair_id"),
    isoCurrency: text("iso_currency").notNull().default("USD"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("transactions_plaid_uq").on(t.plaidTransactionId),
    index("transactions_household_date_idx").on(t.householdId, t.postedDate),
  ],
);

export const transactionOverrides = fire.table("transaction_overrides", {
  transactionId: uuid("transaction_id")
    .primaryKey()
    .references(() => transactions.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  class: txClassEnum("class"),
  essential: boolean("essential"),
  oneTime: boolean("one_time").notNull().default(false),
  /** One-time items can be spread over N years instead of excluded. */
  amortizeYears: integer("amortize_years"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const categoryRules = fire.table(
  "category_rules",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    pfcDetailed: text("pfc_detailed").notNull(),
    class: txClassEnum("class").notNull(),
    essential: boolean("essential").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("category_rules_household_cat_uq").on(t.householdId, t.pfcDetailed)],
);

export const incomeStreams = fire.table(
  "income_streams",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    monthlyCents: cents("monthly_cents").notNull(),
    growth: text("growth").notNull().default("inflation"),
    phase: text("phase").notNull(),
    startAge: doublePrecision("start_age"),
    endAge: doublePrecision("end_age"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("income_streams_household_idx").on(t.householdId)],
);

export const contributionStreams = fire.table(
  "contribution_streams",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    bucket: bucketEnum("bucket").notNull(),
    monthlyCents: cents("monthly_cents").notNull(),
    growth: text("growth").notNull().default("raise"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contribution_streams_household_idx").on(t.householdId)],
);

export const spendingProfiles = fire.table("spending_profiles", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  /** "manual": use the entered figures. "plaid": use the derived annual spending. */
  source: text("source").notNull().default("manual"),
  manualAnnualCents: cents("manual_annual_cents").notNull().default(0),
  manualEssentialCents: cents("manual_essential_cents").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const scenarios = fire.table(
  "scenarios",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isBaseline: boolean("is_baseline").notNull().default(false),
    /** Engine Assumptions input, zod-validated on read. */
    assumptions: jsonb("assumptions").notNull(),
    /** Engine DebtPlan input. */
    debtPlan: jsonb("debt_plan").notNull(),
    policy: text("policy").notNull().default("payoffAtFI"),
    /** Engine SpendingAdjustment[]: how retirement spending differs from today. */
    retirementAdjustments: jsonb("retirement_adjustments").notNull().default([]),
    /** Extra engine IncomeStream[] that apply only in this scenario. */
    extraIncome: jsonb("extra_income").notNull().default([]),
    /** Optional overrides of household spending for this scenario (annual cents). */
    spendingOverrideCents: cents("spending_override_cents"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scenarios_household_idx").on(t.householdId)],
);

export const syncEvents = fire.table(
  "sync_events",
  {
    id: id(),
    /** Null when a webhook names an Item we do not know. */
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => plaidItems.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    /** SHA-256 of the raw webhook body (replay protection) or a run id. */
    payloadHash: text("payload_hash"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sync_events_payload_uq").on(t.payloadHash),
    index("sync_events_item_idx").on(t.itemId),
  ],
);

/**
 * The paired iPhone companion app (FinanceKit: Apple Card, Apple Cash, Savings).
 * The phone encrypts each snapshot with a key shared once at pairing; the key
 * is stored here sealed with the token keyring. One pairing per household.
 */
export const financekitDevices = fire.table(
  "financekit_devices",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** Random id the phone puts on every file, so files from an old pairing are ignored. */
    pairingId: text("pairing_id").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyIv: text("key_iv").notNull(),
    keyVersion: integer("key_version").notNull(),
    deviceName: text("device_name"),
    /** generatedAt of the newest snapshot imported (phone clock). */
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    lastImportAt: timestamp("last_import_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("financekit_devices_household_uq").on(t.householdId)],
);

/** Monthly spending budget per primary category (FOOD_AND_DRINK, ...). */
export const budgets = fire.table(
  "budgets",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    monthlyCents: cents("monthly_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("budgets_household_category_uq").on(t.householdId, t.category)],
);

/**
 * Per-event state for alerts and recurring series, by key ("price:netflix|monthly:2026-11-05",
 * "hide-recurring:apple|monthly|3"): dismissed in the app, or already sent as a Mac notification.
 */
export const alertState = fire.table(
  "alert_state",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("alert_state_household_key_uq").on(t.householdId, t.key)],
);

/**
 * Bills the user knows are coming that the bank history cannot show yet (a new
 * insurance premium, a quarterly payment). Safe to spend counts them on their
 * dates until the history shows the same charge.
 */
export const scheduledBills = fire.table(
  "scheduled_bills",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: cents("amount_cents").notNull(),
    /** weekly, biweekly, monthly, quarterly or yearly. */
    cadence: text("cadence").notNull(),
    /** The next due date as entered; later dates follow the cadence. */
    nextDate: date("next_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scheduled_bills_household_idx").on(t.householdId)],
);

/**
 * Money the user moved (or scheduled) between their accounts to avoid an
 * overdraft, as Safe to spend suggested. The forecast counts it until its
 * deposit shows up; the fees it avoided are kept as worked out on the day.
 */
export const cashMoves = fire.table(
  "cash_moves",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    fromAccountId: uuid("from_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    toAccountId: uuid("to_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amountCents: cents("amount_cents").notNull(),
    /** The day it is to arrive (the suggestion's "by" date). */
    moveDate: date("move_date", { mode: "string" }).notNull(),
    /** The day the account would first have gone below zero. */
    shortfallDate: date("shortfall_date", { mode: "string" }).notNull(),
    feesAvoidedCents: cents("fees_avoided_cents").notNull(),
    feePerItemCents: cents("fee_per_item_cents").notNull(),
    /** "yours", "history" or "typical": where the fee per item came from. */
    feeSource: text("fee_source").notNull(),
    /** The charges that would have come out while overdrawn, and the past fees the fee came from. */
    basis: jsonb("basis")
      .$type<{
        items: { name: string; date: string; cents: number; balanceAfterCents: number }[];
        feeIds: string[];
      }>()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cash_moves_household_idx").on(t.householdId)],
);

/** Alert thresholds and Mac notification preferences. */
export const alertSettings = fire.table("alert_settings", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  largeChargeCents: cents("large_charge_cents").notNull().default(50_000),
  lowBalanceCents: cents("low_balance_cents").notNull().default(50_000),
  billLeadDays: integer("bill_lead_days").notNull().default(5),
  macNotifications: boolean("mac_notifications").notNull().default(true),
  weeklySummary: boolean("weekly_summary").notNull().default(true),
  /** What the bank charges per overdraft, when the user sets it; null uses the history. */
  overdraftFeeCents: cents("overdraft_fee_cents"),
  lastWeeklySummaryAt: timestamp("last_weekly_summary_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Written when a household deletes all its data; holds no personal data. */
export const auditTombstones = fire.table("audit_tombstones", {
  id: id(),
  householdId: uuid("household_id").notNull(),
  reason: text("reason").notNull(),
  rowsDeleted: integer("rows_deleted").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Personal access keys that let an AI assistant (Claude, ChatGPT, Codex, any MCP
 * client) read the plan, and with "write" access make a few reversible changes.
 * Only the SHA-256 of the secret is stored; the secret is shown once at creation.
 * A key is minted from an MFA session, so it carries that second factor.
 */
export const apiTokens = fire.table(
  "api_tokens",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** The Supabase user who created it; the key stops working if they leave the household. */
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    /** "read" or "write". */
    access: text("access").notNull().default("read"),
    /** Hex SHA-256 of the full secret. */
    tokenHash: text("token_hash").notNull(),
    /** First characters of the secret, safe to show ("fire_ab12cd"). */
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** The client name the last MCP session announced (e.g. "claude-ai"). */
    lastClient: text("last_client"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_household_idx").on(t.householdId),
  ],
);

/** Every table that holds household data, for isolation and purge checks. */
export const HOUSEHOLD_TABLES = {
  householdMembers,
  people,
  plaidItems,
  accounts,
  balanceSnapshots,
  holdings,
  debts,
  transactions,
  transactionOverrides,
  categoryRules,
  incomeStreams,
  contributionStreams,
  spendingProfiles,
  scenarios,
  syncEvents,
  financekitDevices,
  budgets,
  alertState,
  alertSettings,
  apiTokens,
  scheduledBills,
  cashMoves,
} as const;
