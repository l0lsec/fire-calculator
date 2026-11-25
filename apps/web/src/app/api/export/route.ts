import { requireApiContext } from "@/lib/auth/context";
import { allow, tooMany } from "@/lib/security/rate-limit";
import { exportHousehold, toCsv } from "@/server/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await requireApiContext();
  if (ctx instanceof Response) return ctx;
  if (!(await allow(`export:${ctx.scope.householdId}`, 10))) return tooMany();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const data = await exportHousehold(ctx);
  const stamp = data.asOf;
  const headers = (type: string, name: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: headers("application/json", `fire-plan-${stamp}.json`),
    });
  }
  const kind = url.searchParams.get("kind") ?? "transactions";
  const rows: Record<string, unknown>[] =
    kind === "accounts"
      ? data.accounts.map((a) => ({
          name: a.name,
          bucket: a.bucket,
          balance: a.currentCents / 100,
          counts_toward_fi: a.includeInFi,
        }))
      : kind === "debts"
        ? data.debts.map((d) => ({
            name: d.name,
            kind: d.kind,
            balance: d.balanceCents / 100,
            apr: d.apr ?? "",
          }))
        : data.transactions.map((t) => ({
            date: t.date,
            account: t.account,
            name: t.name,
            category: t.category ?? "",
            amount: t.amountCents / 100,
          }));
  return new Response(toCsv(rows), {
    headers: headers("text/csv; charset=utf-8", `fire-${kind}-${stamp}.csv`),
  });
}
