// Item sync (BUILD_PLAN section 5 "Reliability"): accounts and balances,
// cursor-based transactions, liabilities and holdings. Idempotent: running it
// twice yields the same rows. Each part can run alone (webhooks name a part).
import {
  type Db,
  getItem,
  type HouseholdScope,
  listAccounts,
  recordSnapshot,
  recordSyncEvent,
  removeTransactions,
  replaceHoldings,
  type TransactionValues,
  updateAccount,
  updateItem,
  upsertDebtFromPlaid,
  upsertPlaidAccount,
  upsertTransactions,
} from "@fire/db";
import { PlaidApiError, type PlaidTransaction } from "@fire/plaid";
import { bankUrl } from "../../../lib/bank-url";
import { todayISO } from "../../today";
import { type PlaidDeps, withAccessToken } from "../config";
import { accountValues, costBasisCents, debtFieldsFrom, holdingsByAccount } from "../mapping";

export type SyncPart = "accounts" | "transactions" | "liabilities" | "holdings";
export const ALL_PARTS: SyncPart[] = ["accounts", "transactions", "liabilities", "holdings"];

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export interface SyncReport {
  itemId: string;
  parts: SyncPart[];
  added: number;
  modified: number;
  removed: number;
  accounts: number;
  debts: number;
  status: "ok" | "login_required" | "error";
  errorCode: string | null;
}

/** Products an institution does not offer are normal, not failures. */
const NOT_AVAILABLE = new Set([
  "PRODUCTS_NOT_SUPPORTED",
  "PRODUCT_NOT_ENABLED",
  "NO_LIABILITY_ACCOUNTS",
  "NO_INVESTMENT_ACCOUNTS",
  "NO_INVESTMENT_AUTH_ACCOUNTS",
  "PRODUCT_NOT_READY",
  "INVALID_PRODUCT",
]);

function txValues(t: PlaidTransaction, accountId: string): TransactionValues {
  return {
    plaidTransactionId: t.transaction_id,
    accountId,
    postedDate: t.date,
    authorizedDate: t.authorized_date,
    amountCents: Math.round(t.amount * 100),
    name: t.name,
    merchant: t.merchant_name ?? null,
    pfcPrimary: t.personal_finance_category?.primary ?? null,
    pfcDetailed: t.personal_finance_category?.detailed ?? null,
    pending: t.pending,
    isoCurrency: t.iso_currency_code ?? "USD",
  };
}

/**
 * Look up the bank's name and website once, for "Open your bank" links. Best
 * effort: a failure leaves it for the next sync and never fails this one.
 */
async function rememberInstitution(
  ctx: Ctx,
  deps: PlaidDeps,
  item: NonNullable<Awaited<ReturnType<typeof getItem>>>,
  fromPlaid: string | null | undefined,
) {
  if (item.institutionUrl !== null) return;
  const id = item.institutionId ?? fromPlaid ?? null;
  if (!id) return;
  try {
    const { institution } = await deps.plaid.institutionsGetById(id);
    await updateItem(ctx.db, ctx.scope, item.id, {
      institutionId: id,
      institutionName: item.institutionName ?? institution.name,
      institutionUrl: bankUrl(institution.url) ?? "",
    });
  } catch {
    // Try again on the next sync.
  }
}

export async function syncItem(
  ctx: Ctx,
  deps: PlaidDeps,
  itemId: string,
  parts: SyncPart[] = ALL_PARTS,
  opts: { asOf?: string; maxRestarts?: number } = {},
): Promise<SyncReport> {
  const asOf = opts.asOf ?? todayISO();
  const item = await getItem(ctx.db, ctx.scope, itemId);
  if (!item) throw new Error("item not found");
  const report: SyncReport = {
    itemId,
    parts,
    added: 0,
    modified: 0,
    removed: 0,
    accounts: 0,
    debts: 0,
    status: "ok",
    errorCode: null,
  };

  try {
    await withAccessToken(deps.ring, item, async (token) => {
      // Accounts always refresh when transactions do: transactions reference them.
      const needAccounts =
        parts.includes("accounts") || parts.includes("transactions") || parts.includes("liabilities");
      const accountIdByPlaid = new Map<string, string>();
      let plaidAccounts: Awaited<ReturnType<typeof deps.plaid.accountsGet>>["accounts"] = [];
      if (needAccounts) {
        const res = await deps.plaid.accountsGet(token);
        plaidAccounts = res.accounts;
        await rememberInstitution(ctx, deps, item, res.item.institution_id);
        for (const a of res.accounts) {
          const row = await upsertPlaidAccount(ctx.db, ctx.scope, item.id, accountValues(a));
          accountIdByPlaid.set(a.account_id, row.id);
          await recordSnapshot(ctx.db, ctx.scope, row.id, asOf, row.currentCents);
        }
        report.accounts = res.accounts.length;
      } else {
        for (const a of await listAccounts(ctx.db, ctx.scope, { includeArchived: true })) {
          if (a.plaidAccountId && a.itemId === item.id) accountIdByPlaid.set(a.plaidAccountId, a.id);
        }
      }

      if (parts.includes("transactions")) {
        const r = await syncTransactions(
          ctx,
          deps,
          token,
          item.transactionsCursor,
          accountIdByPlaid,
          opts.maxRestarts ?? 3,
        );
        Object.assign(report, { added: r.added, modified: r.modified, removed: r.removed });
        await updateItem(ctx.db, ctx.scope, item.id, { transactionsCursor: r.cursor });
      }

      if (parts.includes("liabilities")) {
        let liabilities = null;
        try {
          liabilities = (await deps.plaid.liabilitiesGet(token)).liabilities;
        } catch (e) {
          if (!(e instanceof PlaidApiError && NOT_AVAILABLE.has(e.errorCode))) throw e;
        }
        const fields = debtFieldsFrom(plaidAccounts, liabilities, asOf);
        for (const [plaidAccountId, f] of fields) {
          const accountId = accountIdByPlaid.get(plaidAccountId);
          if (!accountId) continue;
          await upsertDebtFromPlaid(ctx.db, ctx.scope, accountId, f);
          report.debts++;
        }
      }

      if (parts.includes("holdings")) {
        try {
          const res = await deps.plaid.investmentsHoldingsGet(token);
          for (const [plaidAccountId, list] of holdingsByAccount(res)) {
            const accountId = accountIdByPlaid.get(plaidAccountId);
            if (!accountId) continue;
            await replaceHoldings(ctx.db, ctx.scope, accountId, list);
            const basis = costBasisCents(list);
            const account = res.accounts.find((a) => a.account_id === plaidAccountId);
            // Cost basis only matters for taxable accounts (the gains share of withdrawals).
            if (basis !== null && account && accountValues(account).bucket === "taxable") {
              await updateAccount(ctx.db, ctx.scope, accountId, { costBasisCents: basis });
            }
          }
        } catch (e) {
          if (!(e instanceof PlaidApiError && NOT_AVAILABLE.has(e.errorCode))) throw e;
        }
      }
    });
    await updateItem(ctx.db, ctx.scope, item.id, {
      status: "healthy",
      errorCode: null,
      lastSyncedAt: new Date(),
    });
  } catch (e) {
    if (e instanceof PlaidApiError) {
      report.status = e.needsReauth ? "login_required" : "error";
      report.errorCode = e.errorCode;
      await updateItem(ctx.db, ctx.scope, item.id, {
        status: e.needsReauth
          ? e.errorCode === "ITEM_LOGIN_REQUIRED"
            ? "login_required"
            : "pending_disconnect"
          : "error",
        errorCode: e.errorCode,
      });
    } else {
      throw e;
    }
  }

  await recordSyncEvent(ctx.db, {
    householdId: ctx.scope.householdId,
    itemId: item.id,
    kind: `sync:${parts.join(",")}`,
    payloadHash: null,
    status: report.status,
    errorCode: report.errorCode,
    detail: {
      added: report.added,
      modified: report.modified,
      removed: report.removed,
      accounts: report.accounts,
    },
  });
  return report;
}

/**
 * Pages through /transactions/sync from the stored cursor, collecting every
 * change before writing anything. If Plaid reports the data changed during
 * pagination, restart from the cursor saved before the loop (Plaid's documented
 * recovery). Only after a complete pass are rows written and the cursor saved.
 */
async function syncTransactions(
  ctx: Ctx,
  deps: PlaidDeps,
  token: string,
  startCursor: string | null,
  accountIdByPlaid: Map<string, string>,
  maxRestarts: number,
) {
  for (let attempt = 0; ; attempt++) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let cursor = startCursor;
    try {
      for (;;) {
        const page = await deps.plaid.transactionsSync(token, cursor, 500);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((r) => r.transaction_id));
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }
    } catch (e) {
      if (
        e instanceof PlaidApiError &&
        e.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        attempt < maxRestarts
      ) {
        continue;
      }
      throw e;
    }

    const rows: TransactionValues[] = [];
    for (const t of [...added, ...modified]) {
      const accountId = accountIdByPlaid.get(t.account_id);
      if (accountId) rows.push(txValues(t, accountId));
    }
    // Last write wins within a batch (a modified row supersedes its add).
    const byId = new Map(rows.map((r) => [r.plaidTransactionId, r]));
    await upsertTransactions(ctx.db, ctx.scope, [...byId.values()]);
    const removedCount = await removeTransactions(ctx.db, ctx.scope, removed);
    return { cursor, added: added.length, modified: modified.length, removed: removedCount };
  }
}
