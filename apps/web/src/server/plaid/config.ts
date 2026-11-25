// Plaid client and token keyring from server configuration.
import { type Keyring, loadKeyring, open, seal, tokenAad } from "@fire/db/crypto";
import { PlaidClient, type PlaidEnv } from "@fire/plaid";

export class PlaidNotConfiguredError extends Error {
  constructor() {
    super("Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET");
    this.name = "PlaidNotConfiguredError";
  }
}

export interface PlaidDeps {
  plaid: PlaidClient;
  ring: Keyring;
  webhookUrl: string | null;
}

let ringCache: { spec: string; ring: Promise<Keyring> } | null = null;

export function plaidConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.TOKEN_ENCRYPTION_KEYS);
}

export async function plaidDeps(env: NodeJS.ProcessEnv = process.env): Promise<PlaidDeps> {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) throw new PlaidNotConfiguredError();
  const spec = env.TOKEN_ENCRYPTION_KEYS ?? "";
  if (!ringCache || ringCache.spec !== spec) ringCache = { spec, ring: loadKeyring(spec) };
  const plaid = new PlaidClient({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    env: (env.PLAID_ENV === "production" ? "production" : "sandbox") as PlaidEnv,
    ...(env.PLAID_BASE_URL ? { baseUrl: env.PLAID_BASE_URL } : {}),
  });
  return { plaid, ring: await ringCache.ring, webhookUrl: env.PLAID_WEBHOOK_URL || null };
}

export interface SealedItem {
  householdId: string;
  plaidItemId: string;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  keyVersion: number;
}

/** Decrypt an Item's access token for the duration of one call. Never log the result. */
export async function withAccessToken<T>(
  ring: Keyring,
  item: SealedItem,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = await open(
    ring,
    { ciphertext: item.accessTokenCiphertext, iv: item.accessTokenIv, keyVersion: item.keyVersion },
    tokenAad(item.householdId, item.plaidItemId),
  );
  return fn(token);
}

export async function sealToken(ring: Keyring, householdId: string, plaidItemId: string, token: string) {
  return seal(ring, token, tokenAad(householdId, plaidItemId));
}
