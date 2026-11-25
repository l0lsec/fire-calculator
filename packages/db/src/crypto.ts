// Envelope-free AES-256-GCM for Plaid access tokens, on WebCrypto so it runs in
// Workers and Node alike.
//
// Keys come from TOKEN_ENCRYPTION_KEYS: "1:<base64 32 bytes>,2:<base64 32 bytes>".
// The highest version encrypts; any listed version decrypts, which is what lets
// rotation re-encrypt rows without downtime. Each ciphertext is bound to its
// row through additional authenticated data, so a ciphertext copied into a
// different household's row fails to decrypt.

type AesKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export interface Keyring {
  current: number;
  keys: Map<number, AesKey>;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadKeyring(spec: string | undefined): Promise<Keyring> {
  if (!spec) throw new Error("TOKEN_ENCRYPTION_KEYS is not set");
  const keys = new Map<number, AesKey>();
  for (const part of spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [v, material] = part.split(":");
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1 || !material) {
      throw new Error("TOKEN_ENCRYPTION_KEYS entries must look like <version>:<base64>");
    }
    const raw = unb64(material);
    if (raw.length !== 32) throw new Error(`key version ${version} must be 32 bytes`);
    keys.set(version, await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  if (keys.size === 0) throw new Error("TOKEN_ENCRYPTION_KEYS has no keys");
  return { current: Math.max(...keys.keys()), keys };
}

/** AAD binding a token to its household and Plaid Item. */
export function tokenAad(householdId: string, plaidItemId: string): string {
  return `plaid-access-token:${householdId}:${plaidItemId}`;
}

export async function seal(ring: Keyring, plaintext: string, aad: string): Promise<Sealed> {
  const key = ring.keys.get(ring.current);
  if (!key) throw new Error("current key missing from keyring");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: b64(ct), iv: b64(iv), keyVersion: ring.current };
}

export async function open(ring: Keyring, sealed: Sealed, aad: string): Promise<string> {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`no key for version ${sealed.keyVersion}`);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(sealed.iv), additionalData: new TextEncoder().encode(aad) },
      key,
      unb64(sealed.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("token decryption failed (tampered ciphertext, wrong row, or wrong key)");
  }
}

/** Re-encrypt under the current key; a no-op for rows already current. */
export async function reseal(ring: Keyring, sealed: Sealed, aad: string): Promise<Sealed> {
  if (sealed.keyVersion === ring.current) return sealed;
  return seal(ring, await open(ring, sealed, aad), aad);
}

/** A fresh random key spec entry, for setup scripts and tests. */
export function generateKeySpec(version: number): string {
  return `${version}:${b64(crypto.getRandomValues(new Uint8Array(32)))}`;
}
