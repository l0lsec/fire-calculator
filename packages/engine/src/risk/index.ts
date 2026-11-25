// Sequence risk (BUILD_PLAN section 9, T4.2): historical rolling backtests and
// seeded Monte Carlo over the same projection the plan uses. Pure: randomness
// comes from a seeded generator, data from the caller.
import { type EngineInput, monthlyRate } from "../core";
import { fiPortfolio, type Projection, project, type ReturnPath, real } from "../projection";

// ---------- seeded randomness ----------

/** mulberry32: small, fast, deterministic 32-bit generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function gaussian(next: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u <= Number.EPSILON) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// ---------- outcomes ----------

export interface RiskSummary {
  runs: number;
  successes: number;
  successRate: number;
  /** Percentile bands of the real portfolio, sampled every 12 months from the start. */
  bands: { k: number; p10: number; p50: number; p90: number }[];
  /** For historical runs: the start labels that ran out. */
  failures: string[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

function summarize(paths: Projection[], labels: string[]): RiskSummary {
  const horizon = Math.min(...paths.map((p) => p.rows.length));
  const bands: RiskSummary["bands"] = [];
  for (let k = 0; k < horizon; k += 12) {
    const vals = paths.map((p) => real(p.rows[k]!, fiPortfolio(p.rows[k]!))).sort((a, b) => a - b);
    bands.push({ k, p10: quantile(vals, 0.1), p50: quantile(vals, 0.5), p90: quantile(vals, 0.9) });
  }
  const failures = paths
    .map((p, i) => (p.depletedAtK === null ? null : (labels[i] ?? String(i))))
    .filter((x): x is string => x !== null);
  const successes = paths.length - failures.length;
  return {
    runs: paths.length,
    successes,
    successRate: paths.length ? successes / paths.length : 0,
    bands,
    failures,
  };
}

// ---------- Monte Carlo ----------

export interface MonteCarloOptions {
  runs?: number;
  seed?: number;
  /** Annual volatility of invested returns (default 15%). */
  volatility?: number;
  /** Retire after this many months (defaults to the plan's own retirement rule). */
  retireAtK?: number;
  horizonMonths?: number;
}

/**
 * Lognormal monthly returns whose expected annual return equals the plan's
 * nominal assumption; inflation constant at the assumption.
 */
export function monteCarlo(input: EngineInput, opts: MonteCarloOptions = {}): RiskSummary {
  const runs = opts.runs ?? 500;
  const vol = opts.volatility ?? 0.15;
  const z = gaussian(rng(opts.seed ?? 1));
  const sigmaM = vol / Math.sqrt(12);
  // E[exp(X)] = exp(mu + sigma^2/2) = monthly gross expected return.
  const muM = Math.log(1 + monthlyRate(input.assumptions.nominalReturn)) - (sigmaM * sigmaM) / 2;
  const inflM = monthlyRate(input.assumptions.inflation);
  const horizon = opts.horizonMonths ?? project(input, { neverRetire: true }).rows.length - 1;
  const paths: Projection[] = [];
  for (let r = 0; r < runs; r++) {
    const invested = Array.from({ length: horizon }, () => Math.exp(muM + sigmaM * z()) - 1);
    const path: ReturnPath = { invested, inflation: Array.from({ length: horizon }, () => inflM) };
    paths.push(
      project(input, {
        path,
        horizonMonths: horizon,
        ...(opts.retireAtK !== undefined ? { retireAtK: opts.retireAtK } : {}),
      }),
    );
  }
  return summarize(paths, []);
}

// ---------- historical ----------

/** Monthly history: total returns (decimal) for stocks and bonds, and CPI inflation, from `start` (YYYY-MM). */
export interface HistoricalSeries {
  start: string;
  stocks: readonly number[];
  bonds: readonly number[];
  inflation: readonly number[];
}

export interface HistoricalOptions {
  stockShare: number;
  /** Months simulated from each start (for example 360 for 30 years). */
  months: number;
  /** Retire at the first month (a pure drawdown test) unless given. */
  retireAtK?: number;
  /** Rebalanced monthly to stockShare. */
  stepMonths?: number;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Every rolling start (stepped by stepMonths, default 12) that has `months` of data. */
export function historicalBacktest(
  input: EngineInput,
  series: HistoricalSeries,
  opts: HistoricalOptions,
): RiskSummary {
  const n = Math.min(series.stocks.length, series.bonds.length, series.inflation.length);
  const step = opts.stepMonths ?? 12;
  const paths: Projection[] = [];
  const labels: string[] = [];
  for (let s = 0; s + opts.months <= n; s += step) {
    const invested: number[] = [];
    const inflation: number[] = [];
    for (let j = 0; j < opts.months; j++) {
      invested.push(
        opts.stockShare * (series.stocks[s + j] as number) +
          (1 - opts.stockShare) * (series.bonds[s + j] as number),
      );
      inflation.push(series.inflation[s + j] as number);
    }
    paths.push(
      project(input, {
        path: { invested, inflation },
        horizonMonths: opts.months,
        retireAtK: opts.retireAtK ?? 0,
      }),
    );
    labels.push(addMonths(series.start, s));
  }
  return summarize(paths, labels);
}
