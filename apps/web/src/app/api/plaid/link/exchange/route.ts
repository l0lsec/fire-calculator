import { z } from "zod";
import { requireApiContext } from "@/lib/auth/context";
import { PlaidNotConfiguredError, plaidDeps } from "@/server/plaid/config";
import { exchangePublicToken } from "@/server/plaid/link";

export const dynamic = "force-dynamic";

const Body = z.object({
  public_token: z.string().min(1).max(200),
  institution: z.object({ id: z.string().nullable(), name: z.string().nullable() }).nullable().optional(),
});

export async function POST(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const deps = await plaidDeps();
    const r = await exchangePublicToken(
      ctx,
      deps,
      parsed.data.public_token,
      parsed.data.institution ?? { id: null, name: null },
    );
    return Response.json(r);
  } catch (e) {
    if (e instanceof PlaidNotConfiguredError)
      return Response.json({ error: "Bank connections are not configured yet." }, { status: 503 });
    return Response.json({ error: "Could not finish connecting the bank." }, { status: 502 });
  }
}
