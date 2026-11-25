import { z } from "zod";
import { requireApiContext } from "@/lib/auth/context";
import { allow, tooMany } from "@/lib/security/rate-limit";
import { PlaidNotConfiguredError, plaidDeps } from "@/server/plaid/config";
import { createLinkToken } from "@/server/plaid/link";

export const dynamic = "force-dynamic";

const Body = z.object({ itemId: z.string().uuid().optional(), accountSelection: z.boolean().optional() });

export async function POST(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof Response) return ctx;
  if (!(await allow(`plaid:${ctx.scope.householdId}`, 20))) return tooMany();
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const deps = await plaidDeps();
    const res = await createLinkToken(ctx, deps, {
      ...(parsed.data.itemId ? { itemId: parsed.data.itemId } : {}),
      ...(parsed.data.accountSelection ? { accountSelection: true } : {}),
    });
    return Response.json({ link_token: res.link_token, expiration: res.expiration });
  } catch (e) {
    if (e instanceof PlaidNotConfiguredError)
      return Response.json({ error: "Bank connections are not configured yet." }, { status: 503 });
    return Response.json({ error: "Could not start the bank connection." }, { status: 502 });
  }
}
