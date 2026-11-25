// Rate conversions. The engine simulates monthly, in nominal dollars, and
// reports in today's dollars by dividing by the cumulative inflation factor.

/** Monthly rate equivalent to an annual compound rate: (1 + a)^(1/12) - 1. */
export function monthlyRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1;
}

/** Annual compound rate equivalent to a monthly rate. */
export function annualRate(monthly: number): number {
  return (1 + monthly) ** 12 - 1;
}

/** Fisher relation: the real return that nominal r earns under inflation i. */
export function realRate(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

export function nominalRate(real: number, inflation: number): number {
  return (1 + real) * (1 + inflation) - 1;
}

/** Price level after `months` of constant annual inflation, relative to month 0. */
export function deflator(inflation: number, months: number): number {
  return (1 + inflation) ** (months / 12);
}

export function toReal(nominalAmount: number, inflation: number, months: number): number {
  return nominalAmount / deflator(inflation, months);
}

export function toNominal(realAmount: number, inflation: number, months: number): number {
  return realAmount * deflator(inflation, months);
}

/** Present value of `n` level monthly payments discounted at monthly rate r. */
export function annuityPV(payment: number, monthly: number, n: number): number {
  if (n <= 0) return 0;
  if (Math.abs(monthly) < 1e-12) return payment * n;
  return (payment * (1 - (1 + monthly) ** -n)) / monthly;
}
