// Month arithmetic. A month index is year * 12 + (month - 1), so January 2026
// is 24312. Ages are fractional years: (month - birthMonth) / 12.
import type { MonthIndex, Person } from "./schema";

export function monthIndex(year: number, month: number): MonthIndex {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`invalid year/month ${year}-${month}`);
  }
  return year * 12 + (month - 1);
}

export function yearMonth(m: MonthIndex): { year: number; month: number } {
  return { year: Math.floor(m / 12), month: (m % 12) + 1 };
}

/** "2026-01" style label. */
export function monthLabel(m: MonthIndex): string {
  const { year, month } = yearMonth(m);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthLabel(label: string): MonthIndex {
  const match = /^(\d{4})-(\d{2})$/.exec(label);
  if (!match) throw new RangeError(`invalid month label ${label}`);
  return monthIndex(Number(match[1]), Number(match[2]));
}

export function ageAt(person: Person, m: MonthIndex): number {
  return (m - person.birthMonth) / 12;
}

/** First month at which the person is at least `age` years old. */
export function monthAtAge(person: Person, age: number): MonthIndex {
  return person.birthMonth + Math.ceil(age * 12 - 1e-9);
}
