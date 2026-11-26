import Link from "next/link";
import { after } from "next/server";
import type { ReactNode } from "react";
import { AppNav, SectionTabs } from "@/components/app-nav";
import { ToastProvider } from "@/components/toast";
import { requireContext } from "@/lib/auth/context";
import { importFromIphone } from "@/server/financekit";
import { syncStaleItems } from "@/server/plaid/stale";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  // Refresh bank data that has gone stale, after the page has been sent.
  after(() => syncStaleItems(ctx).catch(() => 0));
  // Pick up anything new the iPhone companion app dropped in iCloud Drive.
  after(() => importFromIphone(ctx).catch(() => null));
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
          <div className="relative mx-auto flex max-w-6xl items-center gap-1 px-4 py-2 sm:gap-3">
            <Link
              href="/dashboard"
              className="flex min-h-10 items-center whitespace-nowrap text-sm font-semibold text-accent"
            >
              FIRE Planner
            </Link>
            <AppNav />
            <Link
              href="/alerts"
              className="flex min-h-10 items-center rounded-md px-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-11"
            >
              Alerts
            </Link>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="flex min-h-10 items-center whitespace-nowrap rounded-md px-2 text-sm text-ink-3 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-11"
                aria-label="Sign out"
                title={ctx.email ? `Signed in as ${ctx.email}` : undefined}
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6">
          <SectionTabs />
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
