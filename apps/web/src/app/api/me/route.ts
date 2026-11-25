import { requireApiContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireApiContext();
  if (ctx instanceof Response) return ctx;
  return Response.json({ householdId: ctx.scope.householdId, email: ctx.email });
}
