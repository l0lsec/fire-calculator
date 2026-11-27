// The transactions behind a number, as plain data a server page passes to
// ChargeList (components/charges.tsx). Safe for client and server.

export interface Charge {
  id: string;
  /** Posted date, YYYY-MM-DD. */
  date: string;
  name: string;
  /** "Personal Checking ...5069" */
  account: string;
  /** What this charge adds to the number, in cents (a refund is negative). */
  amountCents: number;
  /** Why the counted amount differs from the charge (spread over years, say). */
  note?: string;
}

/** The sum of the charges, in cents: what the list's total line shows. */
export function chargesTotal(charges: Charge[]): number {
  return charges.reduce((s, c) => s + c.amountCents, 0);
}
