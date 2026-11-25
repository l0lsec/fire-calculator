// Public by design: Plaid calls it. Every request must carry a valid
// Plaid-Verification JWT whose body hash matches (see server/plaid/webhook.ts).
import { getDb } from "@/lib/db";
import { PlaidNotConfiguredError, plaidDeps } from "@/server/plaid/config";
import { handleWebhook } from "@/server/plaid/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY) return Response.json({ error: "too large" }, { status: 413 });
  try {
    const out = await handleWebhook(
      getDb(),
      await plaidDeps(),
      body,
      request.headers.get("plaid-verification"),
    );
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    if (e instanceof PlaidNotConfiguredError)
      return Response.json({ error: "not configured" }, { status: 503 });
    return Response.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
