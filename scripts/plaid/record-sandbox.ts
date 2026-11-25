// Records one real Plaid Sandbox response per endpoint into
// packages/plaid/test/recorded/, with access tokens redacted.
// Needs PLAID_CLIENT_ID and PLAID_SECRET (sandbox) in .env.
// Run: pnpm plaid:record
import { mkdirSync, writeFileSync } from "node:fs";
import { PlaidClient } from "../../packages/plaid/src/client";

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;
if (!clientId || !secret) {
  console.error("PLAID_CLIENT_ID and PLAID_SECRET (sandbox) must be set in .env");
  process.exit(1);
}
if ((process.env.PLAID_ENV ?? "sandbox") !== "sandbox") {
  console.error("refusing to record outside the sandbox");
  process.exit(1);
}

const dir = new URL("../../packages/plaid/test/recorded/", import.meta.url);
mkdirSync(dir, { recursive: true });
let token = "";
const raw: Record<string, unknown> = {};
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const text = await res.text();
  const path = new URL(typeof input === "string" ? input : (input as Request).url).pathname;
  raw[path] = JSON.parse(text);
  return new Response(text, { status: res.status, headers: res.headers });
};
const c = new PlaidClient({ clientId, secret, env: "sandbox", fetch: recordingFetch });
const redact = (o: unknown) =>
  JSON.parse(JSON.stringify(o).replaceAll(token || "@@none@@", "access-sandbox-REDACTED"));
const save = (name: string, path: string) => {
  writeFileSync(new URL(name, dir), `${JSON.stringify(redact(raw[path]), null, 2)}\n`);
  console.log(`recorded ${name}`);
};

await c.linkTokenCreate({ clientUserId: "recorder" });
save("link_token_create.json", "/link/token/create");
const pub = await c.sandboxPublicTokenCreate("ins_109508");
const ex = await c.itemPublicTokenExchange(pub.public_token);
token = ex.access_token;
save("item_public_token_exchange.json", "/item/public_token/exchange");
await c.itemGet(token);
save("item_get.json", "/item/get");
await c.accountsGet(token);
save("accounts_get.json", "/accounts/get");
// The first sync can be empty until Plaid finishes the initial pull; retry briefly.
for (let i = 0; i < 10; i++) {
  const page = await c.transactionsSync(token, null, 100);
  if (page.added.length > 0) break;
  await new Promise((r) => setTimeout(r, 3000));
}
save("transactions_sync.json", "/transactions/sync");
await c.liabilitiesGet(token);
save("liabilities_get.json", "/liabilities/get");
await c.investmentsHoldingsGet(token);
save("investments_holdings_get.json", "/investments/holdings/get");
// /webhook_verification_key/get needs a real key id, which only appears in the
// header of a webhook Plaid actually sent us. Set PLAID_WEBHOOK_KID from one.
if (process.env.PLAID_WEBHOOK_KID) {
  await c.webhookVerificationKeyGet(process.env.PLAID_WEBHOOK_KID);
  save("webhook_verification_key_get.json", "/webhook_verification_key/get");
} else {
  console.log("skipped webhook_verification_key_get (set PLAID_WEBHOOK_KID from a received webhook header)");
}
await c.itemRemove(token);
save("item_remove.json", "/item/remove");
console.log("RECORDING_DONE");
