// Pairing the iPhone companion app and importing what it syncs.
//
// The phone writes "<pairing id>.fpsync" into its iCloud Drive container;
// iCloud mirrors it to this Mac under ~/Library/Mobile Documents. Importing is
// a full snapshot each time: accounts and balances are refreshed, transactions
// are upserted, and companion transactions that vanished from the snapshot
// (a pending charge that dropped, say) are removed. Nothing here listens on
// the network.
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  archiveDebtsForAccounts,
  archiveFinancekitAccounts,
  type Db,
  deleteFinancekitDevice,
  getFinancekitDevice,
  type HouseholdScope,
  listAccounts,
  listTransactions,
  recordSnapshot,
  removeTransactions,
  saveFinancekitPairing,
  updateFinancekitDevice,
  upsertDebtFromPlaid,
  upsertFinancekitAccount,
  upsertTransactions,
} from "@fire/db";
import { type Keyring, loadKeyring, open, seal } from "@fire/db/crypto";
import { todayISO } from "../today";
import {
  Envelope,
  encodePairingCode,
  FILE_EXTENSION,
  newPairing,
  openEnvelope,
  Snapshot,
  SyncFileError,
} from "./format";
import { accountValuesFor, debtFieldsFor, ID_PREFIX, transactionValuesFor } from "./mapping";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
}

/** Bundle id com.showupshowout.fireplanner -> container iCloud.com.showupshowout.fireplanner. */
export const ICLOUD_CONTAINER_DIR = "iCloud~com~showupshowout~fireplanner";

export function syncDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FINANCEKIT_SYNC_DIR ||
    join(homedir(), "Library", "Mobile Documents", ICLOUD_CONTAINER_DIR, "Documents")
  );
}

let ringCache: { spec: string; ring: Promise<Keyring> } | null = null;
async function keyring(env: NodeJS.ProcessEnv = process.env): Promise<Keyring> {
  const spec = env.TOKEN_ENCRYPTION_KEYS ?? "";
  if (!spec) throw new Error("TOKEN_ENCRYPTION_KEYS is not set");
  if (!ringCache || ringCache.spec !== spec) ringCache = { spec, ring: loadKeyring(spec) };
  return ringCache.ring;
}

const keyAad = (householdId: string, pairingId: string) => `financekit-key:${householdId}:${pairingId}`;

// ---------- pairing ----------

/** Create (or replace) the pairing and return the one-time code for the phone. */
export async function pairIphone(ctx: Ctx): Promise<{ code: string }> {
  const { pairingId, key } = newPairing();
  const sealed = await seal(
    await keyring(),
    Buffer.from(key).toString("base64"),
    keyAad(ctx.scope.householdId, pairingId),
  );
  await saveFinancekitPairing(ctx.db, ctx.scope, {
    pairingId,
    keyCiphertext: sealed.ciphertext,
    keyIv: sealed.iv,
    keyVersion: sealed.keyVersion,
  });
  return { code: encodePairingCode(pairingId, key) };
}

/** Forget the phone. Its accounts are archived (history stays) and its cards leave the debt plan. */
export async function unpairIphone(ctx: Ctx): Promise<void> {
  await deleteFinancekitDevice(ctx.db, ctx.scope);
  const ids = await archiveFinancekitAccounts(ctx.db, ctx.scope);
  await archiveDebtsForAccounts(ctx.db, ctx.scope, ids);
}

// ---------- import ----------

export interface ImportReport {
  status: "imported" | "unchanged" | "no-file" | "not-paired" | "downloading" | "error";
  accounts: number;
  transactions: number;
  removed: number;
  error?: string;
}

const empty = (status: ImportReport["status"], error?: string): ImportReport => ({
  status,
  accounts: 0,
  transactions: 0,
  removed: 0,
  ...(error ? { error } : {}),
});

/** Ask iCloud to download a file the Mac has only as a placeholder. */
function requestDownload(path: string): Promise<void> {
  return new Promise((resolve) => execFile("brctl", ["download", path], () => resolve()));
}

async function exists(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Import the newest snapshot from the paired phone, if there is one we have
 * not seen. Cheap when nothing changed (one stat call), so it runs on page load.
 */
export async function importFromIphone(
  ctx: Ctx,
  opts: { dir?: string; force?: boolean; asOf?: string } = {},
): Promise<ImportReport> {
  const device = await getFinancekitDevice(ctx.db, ctx.scope);
  if (!device) return empty("not-paired");
  const dir = opts.dir ?? syncDir();
  const file = join(dir, `${device.pairingId}${FILE_EXTENSION}`);
  const st = await exists(file);
  if (!st) {
    const placeholder = join(dir, `.${device.pairingId}${FILE_EXTENSION}.icloud`);
    if (await exists(placeholder)) {
      await requestDownload(placeholder);
      return empty("downloading");
    }
    return empty("no-file");
  }
  if (!opts.force && device.lastImportAt && st.mtime <= device.lastImportAt) return empty("unchanged");

  try {
    const env = Envelope.parse(JSON.parse(await readFile(file, "utf8")));
    if (env.pid !== device.pairingId) throw new SyncFileError("sync file belongs to an older pairing");
    const keyB64 = await open(
      await keyring(),
      { ciphertext: device.keyCiphertext, iv: device.keyIv, keyVersion: device.keyVersion },
      keyAad(ctx.scope.householdId, device.pairingId),
    );
    const parsed = Snapshot.safeParse(
      JSON.parse(await openEnvelope(env, new Uint8Array(Buffer.from(keyB64, "base64")))),
    );
    if (!parsed.success)
      throw new SyncFileError(`sync file has an unexpected shape: ${parsed.error.issues[0]?.message}`);
    const snap = parsed.data;
    if (!opts.force && device.lastSnapshotAt && new Date(snap.generatedAt) <= device.lastSnapshotAt) {
      await updateFinancekitDevice(ctx.db, ctx.scope, { lastImportAt: new Date(), lastError: null });
      return empty("unchanged");
    }
    const report = await applySnapshot(ctx, snap, opts.asOf ?? todayISO());
    await updateFinancekitDevice(ctx.db, ctx.scope, {
      deviceName: snap.deviceName,
      lastSnapshotAt: new Date(snap.generatedAt),
      lastImportAt: new Date(),
      lastError: null,
    });
    return report;
  } catch (e) {
    const message = e instanceof SyncFileError ? e.message : "sync file could not be read";
    await updateFinancekitDevice(ctx.db, ctx.scope, { lastImportAt: new Date(), lastError: message });
    return empty("error", message);
  }
}

/** Write one snapshot into the household. Idempotent. */
export async function applySnapshot(ctx: Ctx, snap: Snapshot, asOf: string): Promise<ImportReport> {
  const accountIdByFk = new Map<string, { id: string; kind: "asset" | "liability" }>();
  for (const a of snap.accounts) {
    const row = await upsertFinancekitAccount(ctx.db, ctx.scope, accountValuesFor(snap, a));
    accountIdByFk.set(a.id, { id: row.id, kind: a.kind });
    await recordSnapshot(ctx.db, ctx.scope, row.id, asOf, row.currentCents);
    const debt = debtFieldsFor(snap, a);
    if (debt) await upsertDebtFromPlaid(ctx.db, ctx.scope, row.id, debt);
  }

  const rows = snap.transactions.flatMap((t) => {
    const acct = accountIdByFk.get(t.accountId);
    if (!acct) return [];
    const v = transactionValuesFor(t, acct.kind, acct.id, asOf);
    return v ? [v] : [];
  });
  await upsertTransactions(ctx.db, ctx.scope, rows);

  // Anything from these accounts in the snapshot's date range that the phone no
  // longer reports (or that is now left out, like a hold that never settled) was
  // dropped or replaced at Apple: remove it here too. The range is every entry
  // the phone sent, so a left-out entry at its oldest end is still in it.
  let removed = 0;
  const sent = snap.transactions
    .filter((t) => accountIdByFk.has(t.accountId))
    .map((t) => (t.posted && t.posted < t.date ? t.posted : t.date));
  if (sent.length > 0) {
    const from = sent.reduce((m, d) => (d < m ? d : m));
    const keep = new Set(rows.map((r) => r.plaidTransactionId));
    const ours = new Set([...accountIdByFk.values()].map((a) => a.id));
    const existing = await listTransactions(ctx.db, ctx.scope, from, "9999-12-31");
    const gone = existing
      .filter(
        (t) =>
          ours.has(t.accountId) &&
          t.plaidTransactionId.startsWith(ID_PREFIX) &&
          !keep.has(t.plaidTransactionId),
      )
      .map((t) => t.plaidTransactionId);
    removed = await removeTransactions(ctx.db, ctx.scope, gone);
  }
  return { status: "imported", accounts: snap.accounts.length, transactions: rows.length, removed };
}

/** For the Connections page. */
export async function iphoneStatus(ctx: Ctx) {
  const device = await getFinancekitDevice(ctx.db, ctx.scope);
  if (!device) return null;
  const accounts = (await listAccounts(ctx.db, ctx.scope)).filter((a) => a.source === "financekit");
  return {
    deviceName: device.deviceName,
    pairedAt: device.createdAt.toISOString(),
    lastSnapshotAt: device.lastSnapshotAt?.toISOString() ?? null,
    lastImportAt: device.lastImportAt?.toISOString() ?? null,
    lastError: device.lastError,
    accounts: accounts.map((a) => a.name),
  };
}
