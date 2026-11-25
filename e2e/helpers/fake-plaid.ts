// Control channel for the fake Plaid API started in global-setup.ts.
const BASE = `http://127.0.0.1:${Number(process.env.FAKE_PLAID_PORT ?? 3298)}`;
const PORT = Number(process.env.E2E_PORT ?? 3199);

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`fake ${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const fakePlaid = {
  publicToken: () =>
    call<{ public_token: string }>("/__fake/public_token", {
      webhook: `http://127.0.0.1:${PORT}/api/plaid/webhook`,
    }).then((r) => r.public_token),
  setError: (itemId: string, code: string | null) => call("/__fake/set_error", { item_id: itemId, code }),
  fireWebhook: (itemId: string, type: string, code: string, extra: Record<string, unknown> = {}) =>
    call("/__fake/fire_webhook", { item_id: itemId, webhook_type: type, webhook_code: code, extra }),
  addTransactions: (itemId: string, transactions: unknown[]) =>
    call("/__fake/add_transactions", { item_id: itemId, transactions }),
};
