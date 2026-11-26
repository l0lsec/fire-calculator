// Display formatting. Safe for client and server.
import { yearMonth } from "@fire/engine/core";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function usd(dollars: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(dollars)) return "n/a";
  if (opts.compact && Math.abs(dollars) >= 10_000) return compact.format(dollars);
  return (opts.cents ? usd2 : usd0).format(dollars);
}

export function usdCents(cents: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  return usd(cents / 100, opts);
}

export function pct(rate: number, digits = 2): string {
  // Trim trailing zeros after the point only: 0 stays "0%", 7.50 becomes "7.5%".
  const fixed = (rate * 100).toFixed(digits);
  return `${fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed}%`;
}

export function monthName(m: number): string {
  const { year, month } = yearMonth(m);
  return `${MONTHS[month - 1]} ${year}`;
}

export function duration(months: number): string {
  if (months <= 0) return "now";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

export function age(a: number): string {
  return a.toFixed(1).replace(/\.0$/, "");
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Nov 26, 2026" from an ISO timestamp or date, in local time. */
export function dateText(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/** "Nov 26, 2:14 PM" from an ISO timestamp, in local time. */
export function dateTimeText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}
