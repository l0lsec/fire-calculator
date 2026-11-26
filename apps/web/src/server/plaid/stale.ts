// Keeping data fresh without webhooks or a cloud cron (local, personal use):
// when the app is opened, any healthy bank connection not synced for a while is
// synced in the background. Each Item is claimed first (lastSyncedAt = now) so
// a burst of page loads starts one sync, not many.
import { type Db, type HouseholdScope, listItems, updateItem } from "@fire/db";
import { plaidConfigured, plaidDeps } from "./config";
import { syncItem } from "./sync";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

export const STALE_AFTER_HOURS = 12;

export async function staleItems(ctx: Ctx, now = Date.now(), maxAgeHours = STALE_AFTER_HOURS) {
  const items = await listItems(ctx.db, ctx.scope);
  return items.filter(
    (i) =>
      i.status === "healthy" &&
      (!i.lastSyncedAt || now - i.lastSyncedAt.getTime() > maxAgeHours * 3600 * 1000),
  );
}

export async function syncStaleItems(ctx: Ctx, now = Date.now()): Promise<number> {
  if (!plaidConfigured()) return 0;
  const stale = await staleItems(ctx, now);
  if (stale.length === 0) return 0;
  const deps = await plaidDeps();
  let n = 0;
  for (const item of stale) {
    await updateItem(ctx.db, ctx.scope, item.id, { lastSyncedAt: new Date(now) });
    try {
      await syncItem(ctx, deps, item.id);
      n++;
    } catch {
      // A failed background refresh is recorded in sync_events by syncItem where possible;
      // the user can still use "Refresh now".
    }
  }
  return n;
}
