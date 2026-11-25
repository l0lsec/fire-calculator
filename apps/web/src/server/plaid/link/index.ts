// Plaid Link (BUILD_PLAN section 5): link tokens and the server-side public
// token exchange. The access token is encrypted before it touches the database
// and never appears in a response or a log line.
import { createItem, type Db, findItemByPlaidId, getItem, type HouseholdScope } from "@fire/db";
import { type PlaidDeps, sealToken, withAccessToken } from "../config";
import { syncItem } from "../sync";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export async function createLinkToken(
  ctx: Ctx,
  deps: PlaidDeps,
  opts: { itemId?: string; accountSelection?: boolean } = {},
) {
  if (opts.itemId) {
    const item = await getItem(ctx.db, ctx.scope, opts.itemId);
    if (!item) throw new Error("item not found");
    return withAccessToken(deps.ring, item, (token) =>
      deps.plaid.linkTokenCreate({
        clientUserId: ctx.scope.householdId,
        accessToken: token,
        ...(opts.accountSelection ? { accountSelection: true } : {}),
        ...(deps.webhookUrl ? { webhook: deps.webhookUrl } : {}),
      }),
    );
  }
  return deps.plaid.linkTokenCreate({
    clientUserId: ctx.scope.householdId,
    ...(deps.webhookUrl ? { webhook: deps.webhookUrl } : {}),
  });
}

export interface ExchangeResult {
  itemId: string;
  accounts: number;
  status: string;
}

/**
 * Exchange a public token, store the encrypted access token, then run the
 * first sync immediately: Plaid only starts sending SYNC_UPDATES_AVAILABLE
 * after /transactions/sync has been called once for the Item.
 */
export async function exchangePublicToken(
  ctx: Ctx,
  deps: PlaidDeps,
  publicToken: string,
  institution: { id: string | null; name: string | null },
): Promise<ExchangeResult> {
  const ex = await deps.plaid.itemPublicTokenExchange(publicToken);
  const existing = await findItemByPlaidId(ctx.db, ex.item_id);
  if (existing && existing.householdId !== ctx.scope.householdId)
    throw new Error("item belongs to another household");
  const sealed = await sealToken(deps.ring, ctx.scope.householdId, ex.item_id, ex.access_token);
  const item =
    existing ??
    (await createItem(ctx.db, ctx.scope, {
      plaidItemId: ex.item_id,
      institutionId: institution.id,
      institutionName: institution.name,
      accessTokenCiphertext: sealed.ciphertext,
      accessTokenIv: sealed.iv,
      keyVersion: sealed.keyVersion,
    }));
  const report = await syncItem(ctx, deps, item.id);
  return { itemId: item.id, accounts: report.accounts, status: report.status };
}
