# Privacy policy (template)

_Only needed if you host this app for other people. For personal local use, your data never leaves your machine except to Plaid. Replace the bracketed items before publishing._

FIRE Planner ("the app") helps you plan for financial independence. This policy explains what the
app collects, why, and your choices. It was last updated on [date].

## What we collect

- **Account details you give us**: your email address, a second-factor (authenticator) enrollment,
  and the planning details you enter (birth month, income, spending, accounts, debts, scenarios).
- **Bank data, only if you connect a bank through Plaid**: account names and the last digits of
  account numbers, balances, transactions (up to 24 months), credit card, student loan and mortgage
  details (rates, minimum payments, escrow), and investment holdings with cost basis. We do not
  receive your bank username or password; you give those to Plaid, not to us.
- **Operational records**: when data syncs happen and whether they succeeded.

We do not collect Social Security numbers, full account or routing numbers, or identity documents,
and the app cannot move money.

## How we use it

Only to compute your plan: spending, debt payoff, FI targets and dates, and projections. We do not
sell data, show advertising, or share data with anyone except the service providers below.

## Service providers

- **Plaid** connects your bank and retrieves read-only data ([Plaid's privacy policy](https://plaid.com/legal/)).
- **Supabase** hosts authentication and the database.
- **Cloudflare** hosts the app.

## Security

Bank access tokens are encrypted at rest; a second factor is required to see any financial data;
data is isolated per household. See [docs/SECURITY.md] for details.

## Your choices

- **Disconnect** a bank at any time on the Connections page; we revoke our access at Plaid.
- **Export** your data as JSON or CSV on the History page.
- **Delete everything** on the Connections page: we revoke every bank connection and permanently
  delete your data. We keep only a record that a deletion happened, with no personal data.

## Contact

[Owner name and contact address]
