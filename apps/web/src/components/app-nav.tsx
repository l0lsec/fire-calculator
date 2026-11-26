"use client";
// The app's wayfinding: seven places in the order people use them, the current
// one marked, and the pages that belong together shown as tabs under it.
// Phones get the same list in a menu instead of a sideways-scrolling strip.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Place {
  href: string;
  label: string;
  /** Pages shown as tabs under this place; the first is the place itself. */
  tabs?: { href: string; label: string }[];
  /** Other paths that count as being in this place. */
  also?: string[];
}

export const PLACES: Place[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/plan", label: "Plan" },
  { href: "/debts", label: "Debts" },
  {
    href: "/spending",
    label: "Spending",
    tabs: [
      { href: "/spending", label: "Review" },
      { href: "/budgets", label: "Budgets" },
      { href: "/bills", label: "Bills" },
      { href: "/safe-to-spend", label: "Safe to spend" },
    ],
  },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/history", label: "History" },
  {
    href: "/accounts",
    label: "Accounts",
    tabs: [
      { href: "/accounts", label: "Accounts" },
      { href: "/connections", label: "Connections" },
    ],
    also: ["/connect"],
  },
];

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function placeFor(path: string): Place | undefined {
  return PLACES.find(
    (p) =>
      under(path, p.href) || p.tabs?.some((t) => under(path, t.href)) || p.also?.some((a) => under(path, a)),
  );
}

const link = "flex min-h-10 items-center whitespace-nowrap rounded-md px-3 text-sm pointer-coarse:min-h-11";

export function AppNav() {
  const path = usePathname() ?? "";
  const current = placeFor(path);
  const [open, setOpen] = useState(false);
  // Close the phone menu after navigating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger
  useEffect(() => setOpen(false), [path]);

  const items = PLACES.map((p) => {
    const active = p === current;
    return (
      <Link
        key={p.href}
        href={p.href}
        aria-current={active ? "page" : undefined}
        className={`${link} ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
      >
        {p.label}
      </Link>
    );
  });

  return (
    <>
      <nav aria-label="Main" className="hidden flex-1 gap-1 lg:flex">
        {items}
      </nav>
      <div className="flex min-w-0 flex-1 justify-end lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="main-menu"
          aria-label={`Menu, now on ${current ? current.label : "this page"}`}
          onClick={() => setOpen((o) => !o)}
          className={`${link} min-w-0 border border-line text-ink`}
        >
          <span className="truncate">{current ? current.label : "Menu"}</span>
          <span aria-hidden="true" className="ml-2 text-ink-3">
            {open ? "▲" : "▼"}
          </span>
        </button>
      </div>
      {open ? (
        <nav
          id="main-menu"
          aria-label="Main"
          className="absolute inset-x-0 top-full flex flex-col gap-1 border-b border-line bg-bg p-3 shadow-lg lg:hidden"
        >
          {items}
        </nav>
      ) : null}
    </>
  );
}

/** Tabs for the pages that share a place (Spending: Review, Budgets, Bills, Safe to spend). */
export function SectionTabs() {
  const path = usePathname() ?? "";
  const current = placeFor(path);
  if (!current?.tabs) return null;
  return (
    <nav aria-label={`${current.label} sections`} className="mb-5 flex gap-1 border-b border-line">
      {current.tabs.map((t) => {
        const active = under(path, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex min-h-10 items-center border-b-2 px-3 text-sm pointer-coarse:min-h-11 ${
              active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
