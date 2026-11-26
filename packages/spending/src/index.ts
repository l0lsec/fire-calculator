// Spending derivation (BUILD_PLAN section 6). Pure: transactions in, annual
// spending out. Annual spending is the denominator of every FI number, so the
// rules below exist to stop the common double counts:
//   - an internal transfer (both legs on linked accounts) is never spending;
//   - a payment to a LINKED card is a transfer (its purchases are counted line
//     by line), even when the card's side of the payment is not in the data
//     (it posted late, or predates the card's history); a payment to an
//     UNLINKED card is counted, and flagged;
//   - loan payments are debt service, modeled by the debt engine;
//   - mortgage escrow is reported from the mortgage record, not the payment;
//   - investment contributions are saving, not spending;
//   - payroll a business runs is spending (a business cost), never a transfer;
//   - money arriving in a BUSINESS account from outside the linked accounts
//     (card processor deposits, client payments) is income, so business
//     revenue and business costs are both counted;
//   - refunds net against their category.
// Precedence: per-transaction override > household category rule > default.

export type TxClass =
  | "living_expense"
  | "income"
  | "transfer"
  | "debt_payment"
  | "investment_contribution"
  | "refund"
  | "ignore";

export interface SpendingAccount {
  id: string;
  /** Plaid account type: depository, credit, loan, investment, other. */
  type: string;
  subtype: string | null;
  /** Account and institution names and last four digits: used to tell which card a payment went to. */
  name?: string | null;
  institution?: string | null;
  mask?: string | null;
  /** A business account: its spending and income stay in the totals and are also reported apart. */
  business?: boolean;
}

export interface SpendingTx {
  id: string;
  accountId: string;
  /** Posted date, YYYY-MM-DD. */
  date: string;
  /** Plaid convention: positive is money leaving the account. */
  amountCents: number;
  name: string;
  merchant: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pending: boolean;
}

export interface SpendingOverride {
  transactionId: string;
  class?: TxClass | null;
  essential?: boolean | null;
  oneTime?: boolean;
  amortizeYears?: number | null;
}

export interface CategoryRule {
  pfcDetailed: string;
  class: TxClass;
  essential: boolean;
}

export interface MortgageEscrow {
  debtId: string;
  escrowMonthlyCents: number;
}

export interface SpendingInput {
  /** Today, YYYY-MM-DD. The window is the 12 full months before this month. */
  asOf: string;
  accounts: SpendingAccount[];
  transactions: SpendingTx[];
  overrides?: SpendingOverride[];
  rules?: CategoryRule[];
  mortgages?: MortgageEscrow[];
  /** Single transactions above this are one-time candidates (default $2,500). */
  oneTimeThresholdCents?: number;
}

export type Flag = "unlinked-card-payment" | "one-time-candidate" | "possible-spending" | "uncategorized";

export interface Classified {
  tx: SpendingTx;
  class: TxClass;
  essential: boolean;
  category: string;
  reason: string;
  flags: Flag[];
  transferPairId: string | null;
  /** Amount counted toward living spending in the window (cents; refunds negative). */
  countedCents: number;
}

export interface CategoryTotal {
  category: string;
  primary: string;
  essential: boolean;
  totalCents: number;
}

export interface AnnualSpending {
  windowStart: string;
  windowEnd: string;
  monthsOfData: number;
  /** Living spending excluding escrow, annualized (what the engine's currentAnnual receives). */
  livingCents: number;
  livingEssentialCents: number;
  /** Mortgage escrow (property tax, insurance), annual. */
  escrowCents: number;
  /** livingCents + escrowCents: what the household actually spends on living. */
  totalCents: number;
  essentialCents: number;
  discretionaryCents: number;
  incomeCents: number;
  investmentContributionCents: number;
  debtPaymentCents: number;
  /** The part of livingCents spent from business accounts (annualized; already inside livingCents). */
  businessCents: number;
  /** The part of incomeCents received into business accounts. */
  businessIncomeCents: number;
  /** Where income came from, largest first (annualized; business sources marked). */
  incomeSources: { name: string; cents: number; business: boolean }[];
  /** Living spending per account, annualized. */
  byAccount: { accountId: string; livingCents: number }[];
  byCategory: CategoryTotal[];
  monthly: { month: string; livingCents: number }[];
  reviewQueue: { transactionId: string; flag: Flag; amountCents: number; name: string; date: string }[];
  warnings: string[];
  classified: Classified[];
}

// ---------- defaults ----------

/** Detailed categories that are essential by default; everything else is discretionary. */
const ESSENTIAL_DETAILED = new Set([
  "FOOD_AND_DRINK_GROCERIES",
  "TRANSPORTATION_GAS",
  "TRANSPORTATION_PUBLIC_TRANSIT",
  "GENERAL_SERVICES_INSURANCE",
  "GENERAL_SERVICES_CHILDCARE",
  "GENERAL_SERVICES_EDUCATION",
  "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
]);
const ESSENTIAL_PRIMARY = new Set(["RENT_AND_UTILITIES", "MEDICAL"]);

export function defaultEssential(primary: string | null, detailed: string | null): boolean {
  if (detailed && ESSENTIAL_DETAILED.has(detailed)) return true;
  return primary !== null && ESSENTIAL_PRIMARY.has(primary);
}

/** Primaries that never become living expenses by default or by category rule. */
const NON_SPENDING_PRIMARY = new Set([
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
]);
const TRANSFERISH = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);

// ---------- window ----------

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

export function spendingWindow(asOf: string): { start: string; end: string; months: string[] } {
  const current = monthOf(asOf);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 12));
  return { start: `${months[0]}-01`, end: lastDay(months[11] as string), months };
}

function dayDiff(a: string, b: string): number {
  return (
    Math.abs(
      Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)),
    ) / 86_400_000
  );
}

// ---------- transfer matching ----------

/**
 * Pairs an outflow and an inflow of equal absolute amount on two different
 * linked accounts within 3 days, where at least one leg is categorized as a
 * transfer or loan payment. Greedy by date; each transaction pairs once.
 */
export function matchTransfers(txs: SpendingTx[], linkedAccountIds: Set<string>): Map<string, string> {
  const pairOf = new Map<string, string>();
  const eligible = txs
    .filter((t) => !t.pending && linkedAccountIds.has(t.accountId) && t.amountCents !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const outs = eligible.filter((t) => t.amountCents > 0);
  const ins = eligible.filter((t) => t.amountCents < 0);
  for (const o of outs) {
    let best: SpendingTx | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const i of ins) {
      if (pairOf.has(i.id) || i.accountId === o.accountId || i.amountCents !== -o.amountCents) continue;
      if (!TRANSFERISH.has(o.pfcPrimary ?? "") && !TRANSFERISH.has(i.pfcPrimary ?? "")) continue;
      const gap = dayDiff(o.date, i.date);
      if (gap <= 3 && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best) {
      const id = `pair:${o.id}:${best.id}`;
      pairOf.set(o.id, id);
      pairOf.set(best.id, id);
    }
  }
  return pairOf;
}

// ---------- which card a payment went to ----------

/** Card issuers as they appear in payment descriptions and account names. Order matters: "DISCOVER CAP ONE" is Discover. */
const ISSUERS: [string, RegExp][] = [
  ["discover", /\bDISCOVER\b/i],
  ["apple", /\bAPPLE ?CARD\b|\bGS ?BANK\b|\bGOLDMAN SACHS\b/i],
  ["amex", /\bAMERICAN ?EXPRESS\b|\bAMEX\b/i],
  ["capital-one", /\bCAPITAL ?ONE\b|\bCAP ONE\b|\bQUICKSILVER/i],
  ["bank-of-america", /\bBANK OF AMERICA\b|\bBK OF AMER|\bBOFA\b/i],
  ["navy-federal", /\bNAVY FED|\bNAVY FCU\b|\bNFCU\b/i],
  ["chase", /\bCHASE\b/i],
  ["citi", /\bCITI(BANK|CARDS?)?\b/i],
  ["wells-fargo", /\bWELLS FARGO\b/i],
  ["us-bank", /\bU\.? ?S\.? BANK\b/i],
  ["barclays", /\bBARCLAY/i],
  ["synchrony", /\bSYNCHRONY\b|\bSYNCB\b/i],
  ["sofi", /\bSOFI\b/i],
  ["mission-lane", /\bMISSION LANE\b/i],
  ["concora", /\bCONCORA\b/i],
];

export function issuerOf(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [key, re] of ISSUERS) if (re.test(text)) return key;
  return null;
}

/** Standalone four-digit numbers in a description ("CRD 0383", "ID:7341"). */
function fourDigitTokens(text: string): string[] {
  return text.match(/(?<!\d)\d{4}(?!\d)/g) ?? [];
}

const isCardPayment = (t: SpendingTx) => t.pfcDetailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

/**
 * Finds the linked card an unmatched card payment was sent to, so the payment
 * is a transfer even when the card's own side of it is missing. A description
 * that names a linked card's last four digits settles it. Otherwise the issuer
 * decides, unless the household also pays another card from that issuer that
 * is not linked (its last four digits recur in that issuer's payments). Then a
 * payment without digits goes to whichever card's named payments it is closest
 * to in amount (within 25%); if that is the unlinked card, or nothing is that
 * close, it stays counted (and flagged) because it may be either.
 */
export function cardPaymentTargets(
  txs: SpendingTx[],
  accounts: SpendingAccount[],
): (t: SpendingTx) => SpendingAccount | null {
  const cards = accounts
    .filter((a) => a.type === "credit")
    .map((a) => ({ a, issuer: issuerOf(a.name) ?? issuerOf(a.institution) }));
  const byMask = new Map(cards.filter((c) => c.a.mask).map((c) => [c.a.mask as string, c.a]));
  const byIssuer = new Map<string, SpendingAccount[]>();
  for (const c of cards) if (c.issuer) byIssuer.set(c.issuer, [...(byIssuer.get(c.issuer) ?? []), c.a]);

  // Last-four digits that recur in an issuer's payments but belong to no linked card.
  const seen = new Map<string, number>();
  // Payments that name a card, by issuer: what each card's payments usually look like.
  const named = new Map<string, { cents: number; card: SpendingAccount | null }[]>();
  for (const t of txs) {
    if (!isCardPayment(t) || t.amountCents <= 0) continue;
    const issuer = issuerOf(t.name);
    if (!issuer) continue;
    for (const tok of new Set(fourDigitTokens(t.name))) {
      const card = byMask.get(tok) ?? null;
      if (!card) seen.set(`${issuer}:${tok}`, (seen.get(`${issuer}:${tok}`) ?? 0) + 1);
      named.set(issuer, [...(named.get(issuer) ?? []), { cents: t.amountCents, card }]);
    }
  }
  const unlinkedCard = new Set([...seen].filter(([, n]) => n >= 2).map(([k]) => k.split(":")[0] as string));

  return (t) => {
    if (!isCardPayment(t) || t.amountCents <= 0) return null;
    const tokens = fourDigitTokens(t.name);
    for (const tok of tokens) {
      const card = byMask.get(tok);
      if (card) return card;
    }
    const issuer = issuerOf(t.name);
    if (!issuer) return null;
    const linked = byIssuer.get(issuer);
    if (!linked?.length) return null;
    if (!unlinkedCard.has(issuer)) return linked[0] as SpendingAccount;
    let best: { cents: number; card: SpendingAccount | null } | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const n of named.get(issuer) ?? []) {
      const gap = Math.abs(Math.log(t.amountCents / n.cents));
      if (gap < bestGap) {
        best = n;
        bestGap = gap;
      }
    }
    return best && bestGap <= Math.log(1.25) ? best.card : null;
  };
}

// ---------- classification ----------

/** Payroll a business runs ("INTUIT DES:PAYROLL", "PAYROLL DES:PAYROLL"): a cost, not a transfer. */
const PAYROLL = /\bPAYROLL\b/i;
/** Money coming back, not money earned. */
const REVERSAL = /\bRETURN(ED)?\b|\bREVERS|\bREFUND|\bCHARGEBACK|\bADJUSTMENT\b/i;
export const PAYROLL_CATEGORY = "BUSINESS_PAYROLL";

/** A short source name for a deposit: "CliftonLarso-OSV DES:PAYROLL464 ..." becomes "CliftonLarso-OSV". */
function sourceName(t: SpendingTx): string {
  if (t.merchant) return t.merchant;
  const head = t.name.split(/\s+(?:DES|ID|INDN|CO ID|PPD|WEB):/)[0]?.trim() || t.name;
  return head
    .replace(/\s+(?:Conf(?:irmation)?#|for ").*$/i, "")
    .replace(/\s+\d{5,}.*$/, "")
    .slice(0, 40);
}

function defaultClass(
  t: SpendingTx,
  account: SpendingAccount | undefined,
): { class: TxClass; reason: string; flags: Flag[]; category?: string } {
  const p = t.pfcPrimary;
  const d = t.pfcDetailed ?? "";
  if (t.amountCents > 0 && PAYROLL.test(t.name) && (p === "TRANSFER_OUT" || p === null)) {
    return {
      class: "living_expense",
      reason: "payroll (a business cost)",
      flags: [],
      category: PAYROLL_CATEGORY,
    };
  }
  if (account?.business && t.amountCents < 0 && p === "TRANSFER_IN" && !REVERSAL.test(t.name)) {
    return {
      class: "income",
      reason: "money into your business from outside your linked accounts",
      flags: [],
    };
  }
  if (p === "INCOME") return { class: "income", reason: "income category", flags: [] };
  if (p === "LOAN_DISBURSEMENTS") return { class: "ignore", reason: "loan disbursement", flags: [] };
  if (p === "TRANSFER_IN") return { class: "transfer", reason: "incoming transfer", flags: [] };
  if (p === "TRANSFER_OUT") {
    if (d === "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS") {
      return { class: "investment_contribution", reason: "contribution to investments", flags: [] };
    }
    if (d === "TRANSFER_OUT_WITHDRAWAL" || d === "TRANSFER_OUT_OTHER_TRANSFER_OUT") {
      return {
        class: "transfer",
        reason: "cash withdrawal or payment to a person",
        flags: ["possible-spending"],
      };
    }
    return { class: "transfer", reason: "outgoing transfer", flags: [] };
  }
  if (p === "LOAN_PAYMENTS") {
    if (d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") {
      if (account?.type === "credit")
        return { class: "transfer", reason: "payment received by a linked card", flags: [] };
      // Unmatched: the card is not linked, so its purchases cannot be itemized.
      return {
        class: "living_expense",
        reason: "payment to an unlinked card",
        flags: ["unlinked-card-payment"],
      };
    }
    return { class: "debt_payment", reason: "loan payment (modeled by the debt engine)", flags: [] };
  }
  if (p === null) {
    return t.amountCents > 0
      ? { class: "living_expense", reason: "uncategorized outflow", flags: ["uncategorized"] }
      : { class: "ignore", reason: "uncategorized inflow", flags: ["uncategorized"] };
  }
  if (t.amountCents < 0) return { class: "refund", reason: "refund nets against its category", flags: [] };
  return { class: "living_expense", reason: `${p.toLowerCase().replace(/_/g, " ")}`, flags: [] };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function deriveSpending(input: SpendingInput): AnnualSpending {
  const win = spendingWindow(input.asOf);
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const linked = new Set(input.accounts.map((a) => a.id));
  const overrides = new Map((input.overrides ?? []).map((o) => [o.transactionId, o]));
  const rules = new Map((input.rules ?? []).map((r) => [r.pfcDetailed, r]));
  const threshold = input.oneTimeThresholdCents ?? 250_000;
  const warnings: string[] = [];

  const inWindow = input.transactions.filter((t) => !t.pending && t.date >= win.start && t.date <= win.end);
  const pairs = matchTransfers(inWindow, linked);
  const cardFor = cardPaymentTargets(inWindow, input.accounts);

  const classified: Classified[] = inWindow.map((t) => {
    const account = accounts.get(t.accountId);
    let category = t.pfcDetailed ?? t.pfcPrimary ?? "UNCATEGORIZED";
    const pair = pairs.get(t.id) ?? null;
    let {
      class: cls,
      reason,
      flags,
      category: specialCategory,
    } = pair
      ? {
          class: "transfer" as TxClass,
          reason: "matched transfer between linked accounts",
          flags: [] as Flag[],
          category: undefined as string | undefined,
        }
      : defaultClass(t, account);
    if (specialCategory) category = specialCategory;
    if (flags.includes("unlinked-card-payment")) {
      const card = cardFor(t);
      if (card) {
        cls = "transfer";
        reason = `payment to your linked card${card.name ? ` ${card.name}` : ""}${card.mask ? ` ...${card.mask}` : ""}`;
        flags = [];
      }
    }
    let essential = defaultEssential(t.pfcPrimary, t.pfcDetailed);

    // Household rule: may reclassify ordinary spending categories, never the
    // income/transfer/loan primaries (those need a per-transaction override).
    const rule = t.pfcDetailed ? rules.get(t.pfcDetailed) : undefined;
    if (rule && !pair && !NON_SPENDING_PRIMARY.has(t.pfcPrimary ?? "")) {
      essential = rule.essential;
      cls = rule.class === "living_expense" && t.amountCents < 0 ? "refund" : rule.class;
      reason = "household category rule";
    }

    const o = overrides.get(t.id);
    if (o?.class) {
      cls = o.class;
      reason = "your override";
      flags = flags.filter(
        (f) => f !== "possible-spending" && f !== "unlinked-card-payment" && f !== "uncategorized",
      );
    }
    if (o?.essential !== undefined && o.essential !== null) essential = o.essential;

    return { tx: t, class: cls, essential, category, reason, flags, transferPairId: pair, countedCents: 0 };
  });

  // One-time candidates: big against the category's typical month, or over the threshold.
  const monthlyByCat = new Map<string, Map<string, number>>();
  for (const c of classified) {
    if (c.class !== "living_expense" && c.class !== "refund") continue;
    const m = monthlyByCat.get(c.category) ?? new Map<string, number>();
    m.set(monthOf(c.tx.date), (m.get(monthOf(c.tx.date)) ?? 0) + c.tx.amountCents);
    monthlyByCat.set(c.category, m);
  }
  for (const c of classified) {
    if (c.class !== "living_expense" || c.tx.amountCents <= 0) continue;
    const m = monthlyByCat.get(c.category) ?? new Map();
    const med = median(win.months.map((ym) => m.get(ym) ?? 0));
    if (c.tx.amountCents >= threshold || (c.tx.amountCents >= 25_000 && c.tx.amountCents > 3 * med)) {
      c.flags.push("one-time-candidate");
    }
  }

  // Counted amounts.
  for (const c of classified) {
    if (c.class !== "living_expense" && c.class !== "refund") continue;
    const o = overrides.get(c.tx.id);
    if (o?.amortizeYears && o.amortizeYears > 0)
      c.countedCents = Math.round(c.tx.amountCents / o.amortizeYears);
    else if (o?.oneTime) c.countedCents = 0;
    else c.countedCents = c.tx.amountCents;
  }

  // Months of data: from the first month with any posted activity in the window.
  const firstMonth = inWindow.reduce<string | null>(
    (m, t) => (m === null || monthOf(t.date) < m ? monthOf(t.date) : m),
    null,
  );
  const monthsOfData = firstMonth === null ? 0 : win.months.filter((ym) => ym >= firstMonth).length;
  const scale = monthsOfData > 0 && monthsOfData < 12 ? 12 / monthsOfData : 1;
  if (monthsOfData === 0) warnings.push("No transactions in the last 12 months.");
  else if (monthsOfData < 12)
    warnings.push(`Only ${monthsOfData} months of history; spending is annualized from them.`);

  let living = 0;
  let essentialLiving = 0;
  let income = 0;
  let invest = 0;
  let debt = 0;
  let businessLiving = 0;
  let businessIncome = 0;
  const perAccount = new Map<string, number>();
  const sources = new Map<string, number>();
  const cats = new Map<string, CategoryTotal>();
  const monthly = new Map(win.months.map((m) => [m, 0]));
  for (const c of classified) {
    const business = accounts.get(c.tx.accountId)?.business === true;
    if (c.class === "income") {
      income += -c.tx.amountCents;
      if (business) businessIncome += -c.tx.amountCents;
      const key = `${business ? "b" : "p"}:${sourceName(c.tx)}`;
      sources.set(key, (sources.get(key) ?? 0) - c.tx.amountCents);
    }
    if (c.class === "investment_contribution") invest += c.tx.amountCents;
    if (c.class === "debt_payment") debt += c.tx.amountCents;
    if (c.class !== "living_expense" && c.class !== "refund") continue;
    living += c.countedCents;
    if (business) businessLiving += c.countedCents;
    perAccount.set(c.tx.accountId, (perAccount.get(c.tx.accountId) ?? 0) + c.countedCents);
    if (c.essential) essentialLiving += c.countedCents;
    monthly.set(monthOf(c.tx.date), (monthly.get(monthOf(c.tx.date)) ?? 0) + c.countedCents);
    const ct = cats.get(c.category) ?? {
      category: c.category,
      primary: c.tx.pfcPrimary ?? "UNCATEGORIZED",
      essential: c.essential,
      totalCents: 0,
    };
    ct.totalCents += c.countedCents;
    cats.set(c.category, ct);
  }

  const escrow = (input.mortgages ?? []).reduce((s, m) => s + m.escrowMonthlyCents * 12, 0);
  const livingCents = Math.round(living * scale);
  const livingEssentialCents = Math.round(essentialLiving * scale);
  const reviewed = new Set((input.overrides ?? []).map((o) => o.transactionId));

  return {
    windowStart: win.start,
    windowEnd: win.end,
    monthsOfData,
    livingCents,
    livingEssentialCents,
    escrowCents: escrow,
    totalCents: livingCents + escrow,
    essentialCents: livingEssentialCents + escrow,
    discretionaryCents: livingCents - livingEssentialCents,
    incomeCents: Math.round(income * scale),
    investmentContributionCents: Math.round(invest * scale),
    debtPaymentCents: Math.round(debt * scale),
    businessCents: Math.round(businessLiving * scale),
    businessIncomeCents: Math.round(businessIncome * scale),
    incomeSources: [...sources]
      .map(([key, cents]) => ({
        name: key.slice(2),
        cents: Math.round(cents * scale),
        business: key.startsWith("b:"),
      }))
      .sort((a, b) => b.cents - a.cents),
    byAccount: [...perAccount]
      .map(([accountId, cents]) => ({ accountId, livingCents: Math.round(cents * scale) }))
      .sort((a, b) => b.livingCents - a.livingCents),
    byCategory: [...cats.values()]
      .map((c) => ({ ...c, totalCents: Math.round(c.totalCents * scale) }))
      .sort((a, b) => b.totalCents - a.totalCents),
    monthly: [...monthly].map(([month, livingCents]) => ({ month, livingCents })),
    reviewQueue: classified
      .filter((c) => c.flags.length > 0 && !reviewed.has(c.tx.id))
      .flatMap((c) =>
        c.flags.map((flag) => ({
          transactionId: c.tx.id,
          flag,
          amountCents: c.tx.amountCents,
          name: c.tx.merchant ?? c.tx.name,
          date: c.tx.date,
        })),
      )
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
    warnings,
    classified,
  };
}

/**
 * Escrow inside a mortgage payment: the payment minus principal and interest,
 * where P&I is the level payment that retires `balance` at `apr` by maturity.
 * Returns cents per month, never negative.
 */
export function escrowFromPayment(opts: {
  monthlyPaymentCents: number;
  balanceCents: number;
  apr: number;
  asOf: string;
  maturityDate: string;
}): number {
  const n =
    (Number(opts.maturityDate.slice(0, 4)) - Number(opts.asOf.slice(0, 4))) * 12 +
    (Number(opts.maturityDate.slice(5, 7)) - Number(opts.asOf.slice(5, 7)));
  if (n <= 0 || opts.balanceCents <= 0) return Math.max(0, opts.monthlyPaymentCents);
  const r = opts.apr / 12;
  const pi = r === 0 ? opts.balanceCents / n : (opts.balanceCents * r) / (1 - (1 + r) ** -n);
  return Math.max(0, Math.round(opts.monthlyPaymentCents - pi));
}

export * from "./alerts";
export * from "./budgets";
export * from "./recurring";
