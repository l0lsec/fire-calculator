// zod schemas for the Plaid responses this app relies on (BUILD_PLAN section 5).
// Required fields are required: a response missing one fails loudly instead of
// flowing into the planner as undefined. Unknown fields are stripped.
import { z } from "zod";

const str = z.string();
const nstr = z.string().nullable();
const nnum = z.number().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PlaidErrorBody = z.object({
  error_type: str,
  error_code: str,
  error_message: str,
  display_message: nstr.optional(),
  request_id: str.optional(),
});
export type PlaidErrorBody = z.infer<typeof PlaidErrorBody>;

export const Balances = z.object({
  available: nnum,
  current: nnum,
  limit: nnum.optional(),
  iso_currency_code: nstr,
  unofficial_currency_code: nstr.optional(),
});

export const Account = z.object({
  account_id: str,
  balances: Balances,
  mask: nstr,
  name: str,
  official_name: nstr,
  type: str,
  subtype: nstr,
});
export type PlaidAccount = z.infer<typeof Account>;

export const Item = z.object({
  item_id: str,
  institution_id: nstr.optional(),
  webhook: nstr.optional(),
  error: PlaidErrorBody.nullable().optional(),
  available_products: z.array(str).default([]),
  billed_products: z.array(str).default([]),
  consent_expiration_time: nstr.optional(),
});

export const LinkTokenCreateResponse = z.object({ link_token: str, expiration: str, request_id: str });
export const PublicTokenExchangeResponse = z.object({ access_token: str, item_id: str, request_id: str });
export const AccountsGetResponse = z.object({ accounts: z.array(Account), item: Item, request_id: str });
export const ItemGetResponse = z.object({ item: Item, request_id: str });
export const ItemRemoveResponse = z.object({ request_id: str });

export const PersonalFinanceCategory = z.object({
  primary: str,
  detailed: str,
  confidence_level: nstr.optional(),
});

export const Transaction = z.object({
  transaction_id: str,
  account_id: str,
  /** Positive: money out of the account. */
  amount: z.number(),
  iso_currency_code: nstr,
  date: isoDate,
  authorized_date: isoDate.nullable(),
  name: str,
  merchant_name: nstr.optional(),
  pending: z.boolean(),
  personal_finance_category: PersonalFinanceCategory.nullable().optional(),
});
export type PlaidTransaction = z.infer<typeof Transaction>;

export const TransactionsSyncResponse = z.object({
  added: z.array(Transaction),
  modified: z.array(Transaction),
  removed: z.array(z.object({ transaction_id: str, account_id: str.optional() })),
  next_cursor: str,
  has_more: z.boolean(),
  request_id: str,
  transactions_update_status: str.optional(),
});
export type TransactionsSyncResponse = z.infer<typeof TransactionsSyncResponse>;

export const CreditLiability = z.object({
  account_id: nstr,
  aprs: z.array(
    z.object({
      apr_percentage: z.number(),
      apr_type: str,
      balance_subject_to_apr: nnum.optional(),
      interest_charge_amount: nnum.optional(),
    }),
  ),
  is_overdue: z.boolean().nullable().optional(),
  last_payment_amount: nnum.optional(),
  last_statement_balance: nnum.optional(),
  minimum_payment_amount: nnum,
  next_payment_due_date: isoDate.nullable().optional(),
});
export const MortgageLiability = z.object({
  account_id: str,
  interest_rate: z.object({ percentage: nnum, type: nstr }),
  next_monthly_payment: nnum,
  maturity_date: isoDate.nullable(),
  escrow_balance: nnum.optional(),
  origination_principal_amount: nnum.optional(),
  has_pmi: z.boolean().nullable().optional(),
  loan_term: nstr.optional(),
});
export const StudentLiability = z.object({
  account_id: nstr,
  interest_rate_percentage: z.number(),
  minimum_payment_amount: nnum,
  expected_payoff_date: isoDate.nullable().optional(),
  outstanding_interest_amount: nnum.optional(),
  next_payment_due_date: isoDate.nullable().optional(),
});
export const LiabilitiesGetResponse = z.object({
  accounts: z.array(Account),
  item: Item,
  liabilities: z.object({
    credit: z.array(CreditLiability).nullable(),
    mortgage: z.array(MortgageLiability).nullable(),
    student: z.array(StudentLiability).nullable(),
  }),
  request_id: str,
});
export type LiabilitiesGetResponse = z.infer<typeof LiabilitiesGetResponse>;

export const Holding = z.object({
  account_id: str,
  security_id: str,
  quantity: z.number(),
  institution_value: z.number(),
  institution_price: z.number(),
  cost_basis: nnum,
});
export const Security = z.object({
  security_id: str,
  ticker_symbol: nstr,
  name: nstr,
  type: nstr,
});
export const InvestmentsHoldingsGetResponse = z.object({
  accounts: z.array(Account),
  holdings: z.array(Holding),
  securities: z.array(Security),
  item: Item,
  request_id: str,
});
export type InvestmentsHoldingsGetResponse = z.infer<typeof InvestmentsHoldingsGetResponse>;

export const WebhookVerificationKeyGetResponse = z.object({
  key: z.object({
    alg: str,
    crv: str,
    kid: str,
    kty: str,
    use: str,
    x: str,
    y: str,
    created_at: z.number(),
    expired_at: nnum,
  }),
  request_id: str,
});
export type WebhookKey = z.infer<typeof WebhookVerificationKeyGetResponse>["key"];

export const SandboxPublicTokenCreateResponse = z.object({ public_token: str, request_id: str });
export const SandboxFireWebhookResponse = z.object({ webhook_fired: z.boolean(), request_id: str });
export const SandboxResetLoginResponse = z.object({ reset_login: z.boolean(), request_id: str });

/** Webhook bodies: only the routing fields are required; the rest is kept as-is. */
export const WebhookPayload = z.looseObject({
  webhook_type: str,
  webhook_code: str,
  item_id: str.optional(),
  error: PlaidErrorBody.nullable().optional(),
  environment: str.optional(),
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;
