// The companion iPhone app's sync file format (version 1).
//
// The phone (FIRE Planner Sync) reads Apple Card, Apple Cash and Savings
// through FinanceKit and writes one file per pairing into its iCloud Drive
// folder. The file is an envelope around an AES-256-GCM sealed JSON snapshot:
//
//   { "v": 1, "pid": "<pairing id>", "box": "<base64 nonce || ciphertext || tag>" }
//
// The key (32 random bytes) is created on the Mac at pairing and moved to the
// phone once, inside the pairing code. The pairing id is bound in as AAD, so a
// file from an older pairing never decrypts under the current one. Apple only
// ever stores ciphertext. Must match ios/FIREPlannerSync/Shared/SyncFormat.swift.
import { z } from "zod";

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = ".fpsync";

export function aadFor(pairingId: string): string {
  return `fireplanner-financekit:v1:${pairingId}`;
}

// ---------- pairing code ----------

const PID_RE = /^[0-9a-f]{16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** "fp1.<16 hex pairing id>.<43 char base64url key>", easy to copy between devices. */
export function encodePairingCode(pairingId: string, key: Uint8Array): string {
  if (!PID_RE.test(pairingId)) throw new Error("bad pairing id");
  if (key.length !== 32) throw new Error("pairing key must be 32 bytes");
  return `fp1.${pairingId}.${Buffer.from(key).toString("base64url")}`;
}

export function decodePairingCode(code: string): { pairingId: string; key: Uint8Array } | null {
  const m = code.trim().match(/^fp1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/);
  if (!m || !KEY_RE.test(m[2] as string)) return null;
  const key = new Uint8Array(Buffer.from(m[2] as string, "base64url"));
  return key.length === 32 ? { pairingId: m[1] as string, key } : null;
}

export function newPairing(): { pairingId: string; key: Uint8Array } {
  return {
    pairingId: Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex"),
    key: crypto.getRandomValues(new Uint8Array(32)),
  };
}

// ---------- envelope ----------

export const Envelope = z.object({
  v: z.literal(FORMAT_VERSION),
  pid: z.string().regex(PID_RE),
  box: z.string().min(40).max(50_000_000),
});
export type Envelope = z.infer<typeof Envelope>;

export class SyncFileError extends Error {}

async function aesKey(key: Uint8Array) {
  return crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Decrypt an envelope; throws SyncFileError on a wrong key, wrong pairing or tampering. */
export async function openEnvelope(env: Envelope, key: Uint8Array): Promise<string> {
  const box = Buffer.from(env.box, "base64");
  if (box.length < 12 + 16) throw new SyncFileError("sync file is truncated");
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: box.subarray(0, 12),
        additionalData: new TextEncoder().encode(aadFor(env.pid)),
      },
      await aesKey(key),
      box.subarray(12),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new SyncFileError("sync file did not decrypt (re-pair the iPhone if this persists)");
  }
}

/** The phone side of openEnvelope, used by tests and fixtures. */
export async function sealEnvelope(pairingId: string, key: Uint8Array, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aadFor(pairingId)) },
    await aesKey(key),
    new TextEncoder().encode(plaintext),
  );
  return {
    v: FORMAT_VERSION,
    pid: pairingId,
    box: Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString("base64"),
  };
}

// ---------- snapshot ----------

const Decimal = z.string().regex(/^-?\d{1,13}(\.\d{1,6})?$/, "decimal string");
/** Swift's Codable leaves nil optionals out of the JSON: missing and null both mean null. */
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => v ?? null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Indicator = z.enum(["credit", "debit"]);

export const SnapshotAccount = z.object({
  id: z.string().uuid(),
  kind: z.enum(["asset", "liability"]),
  displayName: z.string().min(1).max(200),
  description: opt(z.string().max(500)),
  institution: z.string().max(200),
  currency: z.string().length(3),
  credit: z
    .object({
      limit: opt(Decimal),
      minimumNext: opt(Decimal),
      nextDue: opt(Day),
      overdue: opt(Decimal),
    })
    .nullish()
    .transform((v) => v ?? null),
});

export const SnapshotBalance = z.object({
  accountId: z.string().uuid(),
  kind: z.enum(["booked", "available"]),
  amount: Decimal,
  indicator: Indicator,
  asOf: z.string().datetime({ offset: true }),
});

export const SnapshotTransaction = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  /** Always non-negative; the direction is the indicator. */
  amount: Decimal,
  indicator: Indicator,
  description: z.string().max(500),
  merchant: opt(z.string().max(200)),
  mcc: opt(z.number().int().min(0).max(9999)),
  type: z.string().max(40),
  status: z.enum(["authorized", "memo", "pending", "booked", "rejected"]),
  date: Day,
  posted: opt(Day),
  currency: z.string().length(3),
});

export const Snapshot = z.object({
  v: z.literal(FORMAT_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  deviceName: opt(z.string().max(100)),
  accounts: z.array(SnapshotAccount).max(50),
  balances: z.array(SnapshotBalance).max(5000),
  transactions: z.array(SnapshotTransaction).max(100_000),
});
export type Snapshot = z.infer<typeof Snapshot>;
export type SnapshotAccount = z.infer<typeof SnapshotAccount>;
export type SnapshotTransaction = z.infer<typeof SnapshotTransaction>;

/** "12.345" -> 1235 cents, without going through binary floating point. */
export function decimalToCents(d: string): number {
  const neg = d.startsWith("-");
  const [whole, frac = ""] = (neg ? d.slice(1) : d).split(".");
  const padded = `${frac}000`;
  let cents = Number(whole) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}
