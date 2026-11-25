import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-accent">FIRE Planner</p>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
