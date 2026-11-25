import Link from "next/link";
import type { ReactNode } from "react";
import { requireContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const NAV = [
  ["/dashboard", "Dashboard"],
  ["/debts", "Debts"],
  ["/spending", "Spending"],
  ["/plan", "Plan"],
  ["/scenarios", "Scenarios"],
  ["/accounts", "Accounts"],
  ["/history", "History"],
] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="text-sm font-semibold text-accent">
            FIRE Planner
          </Link>
          <nav aria-label="Main" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-sm text-ink-3 hover:text-ink"
              title={ctx.email ?? undefined}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
