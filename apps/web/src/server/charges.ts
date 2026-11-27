// Look up the transactions behind a number, so every figure built from
// transactions can open the charges it is made of (docs/UX_PRINCIPLES.md, law 19).
import type { Classified } from "@fire/spending";
import type { Charge } from "@/lib/charges";
import { usdCents } from "@/lib/format";

interface AccountName {
  id: string;
  name: string;
  mask: string | null;
}

/** Newest first, then the larger charge first. */
const order = (a: Charge, b: Charge) => b.date.localeCompare(a.date) || b.amountCents - a.amountCents;

export function chargeFinder(classified: Classified[], accounts: AccountName[]) {
  const names = new Map(accounts.map((a) => [a.id, `${a.name}${a.mask ? ` ...${a.mask}` : ""}`]));
  const byId = new Map(classified.map((c) => [c.tx.id, c]));
  // One object per transaction and amount, so a charge listed under several
  // figures on a page is sent to the browser once (React dedupes repeated objects).
  const made = new Map<string, Charge>();
  const toCharge = (c: Classified, counted: boolean): Charge => {
    const cents = counted ? c.countedCents : c.tx.amountCents;
    const key = `${c.tx.id}:${cents}`;
    const seen = made.get(key);
    if (seen) return seen;
    const charge: Charge = {
      id: c.tx.id,
      date: c.tx.date,
      name: c.tx.name,
      account: names.get(c.tx.accountId) ?? "an account",
      amountCents: cents,
      ...(cents !== c.tx.amountCents
        ? { note: `${usdCents(c.tx.amountCents, { cents: true })} charge; ${c.reason}` }
        : {}),
    };
    made.set(key, charge);
    return charge;
  };
  return {
    /** These transactions at their full amounts (a recurring series' charges). */
    byIds(ids: string[]): Charge[] {
      return ids
        .map((id) => byId.get(id))
        .filter((c): c is Classified => c !== undefined)
        .map((c) => toCharge(c, false))
        .sort(order);
    },
    /**
     * Every posted transaction that matches, at the amount it counts toward
     * living spending when `counted` (one-time and spread-out charges differ).
     */
    where(match: (c: Classified) => boolean, { counted = false }: { counted?: boolean } = {}): Charge[] {
      return classified
        .filter((c) => !c.tx.pending && match(c))
        .map((c) => toCharge(c, counted))
        .sort(order);
    },
  };
}

export type ChargeFinder = ReturnType<typeof chargeFinder>;

/** Living spending and refunds: the transactions that count toward spending and budgets. */
export const isLiving = (c: Classified) => c.class === "living_expense" || c.class === "refund";
