// The engine contract. Every input crosses this boundary as a zod-validated
// value; every module downstream may assume these invariants hold.
//
// Units:
// - Months are absolute integer indices: year * 12 + (month - 1). See time.ts.
// - Rates are annual decimals (0.07 means 7% a year).
// - Money is in dollars (float). Observed data is stored in cents elsewhere and
//   converted at the snapshot boundary.
// - "Today's dollars" means dollars at startMonth purchasing power.
import { z } from "zod";

export const MonthIndex = z
  .number()
  .int()
  .min(0)
  .max(12 * 3000);
export type MonthIndex = z.infer<typeof MonthIndex>;

const money = z.number().finite();
const nonNegMoney = money.min(0);
const rate = z.number().finite().min(-0.99).max(1);
const apr = z.number().finite().min(0).max(1);

export const Bucket = z.enum(["cash", "taxable", "traditional", "roth", "hsa", "excluded"]);
export type Bucket = z.infer<typeof Bucket>;
export const INVESTABLE_BUCKETS = ["cash", "taxable", "traditional", "roth", "hsa"] as const;
export type InvestableBucket = (typeof INVESTABLE_BUCKETS)[number];

export const Person = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  birthMonth: MonthIndex,
});
export type Person = z.infer<typeof Person>;

export const Account = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bucket: Bucket,
  balance: money,
  includeInFI: z.boolean().default(true),
  /** Taxable accounts: total cost basis, for the gains share of withdrawals. */
  costBasis: nonNegMoney.optional(),
  /** Roth accounts: contributions (withdrawable before 59.5 without penalty). */
  rothContributionBasis: nonNegMoney.optional(),
});
export type Account = z.infer<typeof Account>;

export const DebtKind = z.enum([
  "credit_card",
  "student",
  "mortgage",
  "auto",
  "personal",
  "heloc",
  "medical",
  "other",
]);
export type DebtKind = z.infer<typeof DebtKind>;

export const MinPaymentRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amount: nonNegMoney }),
  /** Card style: max(floor, pct * balance + interest), never above what is owed. */
  z.object({ type: z.literal("card"), floor: nonNegMoney, pct: z.number().min(0).max(1) }),
]);
export type MinPaymentRule = z.infer<typeof MinPaymentRule>;

export const Debt = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: DebtKind,
  balance: nonNegMoney,
  apr,
  minPayment: MinPaymentRule,
  promo: z.object({ apr, endsMonth: MonthIndex }).optional(),
  /**
   * Mortgages: monthly escrow (property tax, insurance). Modeled as a permanent
   * essential expense that outlives the loan; never part of the debt payment.
   */
  escrowMonthly: nonNegMoney.default(0),
});
export type Debt = z.infer<typeof Debt>;

export const Strategy = z.enum(["avalanche", "snowball", "custom", "hybrid", "minimum"]);
export type Strategy = z.infer<typeof Strategy>;

export const DebtPlan = z.object({
  strategy: Strategy.default("avalanche"),
  extraMonthly: nonNegMoney.default(0),
  /** For "custom": debt ids in payoff order; unlisted debts follow by avalanche. */
  customOrder: z.array(z.string()).default([]),
  /** For "hybrid": only debts above this APR receive extra dollars. */
  hybridThreshold: apr.default(0.07),
});
export type DebtPlan = z.infer<typeof DebtPlan>;

export const DebtPolicy = z.enum(["payoffAtFI", "keepMortgage", "debtFreeFirst"]);
export type DebtPolicy = z.infer<typeof DebtPolicy>;

const Growth = z.enum(["raise", "inflation", "none"]);

export const IncomeStream = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["takeHome", "partTime", "socialSecurity", "pension", "other"]),
  personId: z.string().min(1),
  /** Monthly, in today's dollars. */
  monthly: nonNegMoney,
  growth: Growth.default("inflation"),
  /** "working": until retirement. "retired": after retirement. "always": both. */
  phase: z.enum(["working", "retired", "always"]),
  startAge: z.number().min(0).max(120).optional(),
  endAge: z.number().min(0).max(120).optional(),
});
export type IncomeStream = z.infer<typeof IncomeStream>;

export const ContributionStream = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bucket: z.enum(["taxable", "traditional", "roth", "hsa", "cash"]),
  /** Monthly, in today's dollars; paid only while working. Not part of take-home. */
  monthly: nonNegMoney,
  growth: Growth.default("raise"),
});
export type ContributionStream = z.infer<typeof ContributionStream>;

export const SpendingAdjustment = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Annual, today's dollars; negative removes spending (for example, commuting). */
  annual: money,
  essential: z.boolean().default(false),
  fromAge: z.number().min(0).max(120).optional(),
  untilAge: z.number().min(0).max(120).optional(),
});
export type SpendingAdjustment = z.infer<typeof SpendingAdjustment>;

export const Spending = z.object({
  /** Current annual living expenses, excluding all debt payments and escrow. */
  currentAnnual: nonNegMoney,
  /** Essential share of currentAnnual. */
  currentEssentialAnnual: nonNegMoney,
  /** Named lines that turn current spending into retirement spending. */
  retirementAdjustments: z.array(SpendingAdjustment).default([]),
});
export type Spending = z.infer<typeof Spending>;

export const Allocation = z.object({
  taxable: z.number().min(0).max(1),
  traditional: z.number().min(0).max(1),
  roth: z.number().min(0).max(1),
  hsa: z.number().min(0).max(1),
  cash: z.number().min(0).max(1),
});
export type Allocation = z.infer<typeof Allocation>;

export const PartTimePlan = z.object({
  /** Net part-time income, annual, today's dollars. */
  annualNet: nonNegMoney,
  /** Extra annual health cost if the job does not provide coverage. */
  healthAnnual: nonNegMoney.default(0),
  /** Bridged Barista FI: part-time until this age, then full FI. Absent: perpetual. */
  untilAge: z.number().min(18).max(100).optional(),
});
export type PartTimePlan = z.infer<typeof PartTimePlan>;

export const Assumptions = z.object({
  nominalReturn: rate.default(0.07),
  inflation: rate.default(0.03),
  cashReturn: rate.default(0.02),
  raiseRate: rate.default(0.03),
  swr: z.number().min(0.005).max(0.2).default(0.04),
  /** Traditional retirement age used for Coast FI. */
  retirementAge: z.number().min(30).max(90).default(60),
  lifeExpectancy: z.number().min(50).max(120).default(95),
  emergencyMonths: z.number().min(0).max(36).default(6),
  fillEmergencyFirst: z.boolean().default(true),
  fatMultiplier: z.number().min(1).max(10).default(1.5),
  /** Absolute Fat FI annual spending; overrides fatMultiplier when present. */
  fatAnnual: nonNegMoney.optional(),
  /** Effective tax on retirement withdrawals; grosses up the spending part of targets. */
  withdrawalTaxRate: z.number().min(0).max(0.6).default(0.1),
  /** When to stop working in the plan path. */
  retireAt: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("fi") }),
      z.object({ mode: z.literal("age"), age: z.number().min(18).max(100) }),
    ])
    .default({ mode: "fi" }),
  allocation: Allocation.default({ taxable: 1, traditional: 0, roth: 0, hsa: 0, cash: 0 }),
  withdrawalOrder: z
    .array(z.enum(["cash", "taxable", "traditional", "roth", "hsa"]))
    .default(["cash", "taxable", "traditional", "roth", "hsa"]),
  partTime: PartTimePlan.optional(),
  /** Count Social Security and pensions against spending in FI targets. */
  countGuaranteedIncome: z.boolean().default(false),
});
export type Assumptions = z.infer<typeof Assumptions>;

export const EngineInput = z.object({
  startMonth: MonthIndex,
  people: z.array(Person).min(1).max(2),
  accounts: z.array(Account).default([]),
  debts: z.array(Debt).default([]),
  income: z.array(IncomeStream).default([]),
  contributions: z.array(ContributionStream).default([]),
  spending: Spending,
  assumptions: Assumptions.default(Assumptions.parse({})),
  debtPlan: DebtPlan.default(DebtPlan.parse({})),
  policy: DebtPolicy.default("payoffAtFI"),
});
export type EngineInput = z.infer<typeof EngineInput>;
/** What callers may pass: defaults are filled in by parseEngineInput. */
export type EngineInputDraft = z.input<typeof EngineInput>;

export const WarningCode = z.enum([
  "negative-amortization",
  "debt-not-repaid",
  "deficit",
  "portfolio-depleted",
  "fi-before-59-5-traditional-heavy",
  "unknown-apr",
  "short-history",
  "horizon-capped",
]);
export type WarningCode = z.infer<typeof WarningCode>;
export const EngineWarning = z.object({
  code: WarningCode,
  message: z.string(),
  month: MonthIndex.optional(),
  ref: z.string().optional(),
});
export type EngineWarning = z.infer<typeof EngineWarning>;

/** Validate and fill defaults. Throws a ZodError with field paths on bad input. */
export function parseEngineInput(draft: EngineInputDraft): EngineInput {
  const input = EngineInput.parse(draft);
  const ids = new Set(input.people.map((p) => p.id));
  for (const s of input.income) {
    if (!ids.has(s.personId))
      throw new Error(`income stream ${s.id} references unknown person ${s.personId}`);
  }
  const sum = Object.values(input.assumptions.allocation).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`allocation must sum to 1, got ${sum}`);
  if (input.spending.currentEssentialAnnual > input.spending.currentAnnual + 1e-9) {
    throw new Error("essential spending cannot exceed total spending");
  }
  return input;
}
