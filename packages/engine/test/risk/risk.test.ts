import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type EngineInputDraft, monthIndex, monthlyRate, parseEngineInput } from "../../src/core";
import { project } from "../../src/projection";
import { gaussian, type HistoricalSeries, historicalBacktest, monteCarlo, rng } from "../../src/risk";

const START = monthIndex(2026, 1);

function retiree(portfolio: number, spend: number, over: Partial<EngineInputDraft> = {}) {
  return parseEngineInput({
    startMonth: START,
    people: [{ id: "p1", name: "R", birthMonth: START - 60 * 12 }],
    accounts: [{ id: "b", name: "B", bucket: "taxable", balance: portfolio }],
    spending: { currentAnnual: spend, currentEssentialAnnual: spend / 2 },
    assumptions: {
      nominalReturn: 0.07,
      inflation: 0.03,
      withdrawalTaxRate: 0,
      emergencyMonths: 0,
      lifeExpectancy: 90,
    },
    ...over,
  });
}

describe("randomness", () => {
  it("the same seed gives identical Monte Carlo output", () => {
    const input = retiree(1_000_000, 40_000);
    const a = monteCarlo(input, { runs: 120, seed: 42, retireAtK: 0, horizonMonths: 360 });
    const b = monteCarlo(input, { runs: 120, seed: 42, retireAtK: 0, horizonMonths: 360 });
    const c = monteCarlo(input, { runs: 120, seed: 43, retireAtK: 0, horizonMonths: 360 });
    expect(a).toEqual(b);
    expect(c.bands).not.toEqual(a.bands);
  });

  it("the generator is uniform and the normal has unit variance", () => {
    const u = rng(7);
    const xs = Array.from({ length: 50_000 }, u);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    const z = gaussian(rng(9));
    const zs = Array.from({ length: 50_000 }, z);
    const m = zs.reduce((s, x) => s + x, 0) / zs.length;
    const v = zs.reduce((s, x) => s + (x - m) ** 2, 0) / zs.length;
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(v).toBeGreaterThan(0.97);
    expect(v).toBeLessThan(1.03);
  });

  it("zero volatility reproduces the deterministic projection, and more money never lowers success", () => {
    const input = retiree(1_000_000, 45_000);
    const det = project(input, { retireAtK: 0, horizonMonths: 360 });
    const mc = monteCarlo(input, { runs: 3, seed: 1, volatility: 0, retireAtK: 0, horizonMonths: 360 });
    expect(mc.successRate).toBe(det.depletedAtK === null ? 1 : 0);
    const last = mc.bands[mc.bands.length - 1]!;
    expect(last.p50).toBeCloseTo(det.rows[last.k]!.buckets.taxable / det.rows[last.k]!.deflator, 0);

    const poor = monteCarlo(retiree(700_000, 45_000), {
      runs: 200,
      seed: 5,
      retireAtK: 0,
      horizonMonths: 360,
    });
    const rich = monteCarlo(retiree(1_400_000, 45_000), {
      runs: 200,
      seed: 5,
      retireAtK: 0,
      horizonMonths: 360,
    });
    expect(rich.successRate).toBeGreaterThanOrEqual(poor.successRate);
  });
});

describe("historical", () => {
  it("rolling starts use the series in order and report failing start years", () => {
    // Synthetic series: 40 good years then a 10-year crash, constant inflation.
    const months = 50 * 12;
    const series: HistoricalSeries = {
      start: "1950-01",
      stocks: Array.from({ length: months }, (_, i) => (i < 480 ? monthlyRate(0.08) : monthlyRate(-0.15))),
      bonds: Array.from({ length: months }, () => monthlyRate(0.04)),
      inflation: Array.from({ length: months }, () => monthlyRate(0.03)),
    };
    const input = retiree(1_000_000, 50_000);
    const r = historicalBacktest(input, series, { stockShare: 0.6, months: 360 });
    expect(r.runs).toBe(21);
    // Late starts hit the crash with less runway.
    expect(r.failures.every((l) => l >= "1950-01")).toBe(true);
    if (r.failures.length) expect(r.failures[0]! > "1960-01").toBe(true);
  });

  // The bundled public dataset (packages/engine/data/us-monthly.json) is required
  // for the plan's gate; see packages/engine/data/SOURCES.md.
  const dataFile = new URL("../../data/us-monthly.json", import.meta.url);
  it.skipIf(!existsSync(dataFile))(
    "a 4% withdrawal over 30 years on 60/40 succeeds in 90% to 100% of rolling historical starts",
    () => {
      const series = JSON.parse(readFileSync(dataFile, "utf8")) as HistoricalSeries;
      // 4% of 1,000,000, inflation adjusted, as living spending (no taxes, no reserve).
      const input = retiree(1_000_000, 40_000, {
        assumptions: {
          nominalReturn: 0.07,
          inflation: 0.03,
          withdrawalTaxRate: 0,
          emergencyMonths: 0,
          lifeExpectancy: 95,
        },
      });
      const r = historicalBacktest(input, series, { stockShare: 0.6, months: 360 });
      console.log(
        `historical 4%/30y/60-40: ${(r.successRate * 100).toFixed(1)}% of ${r.runs} starts; failed: ${r.failures.join(", ") || "none"}`,
      );
      expect(r.runs).toBeGreaterThan(60);
      expect(r.successRate).toBeGreaterThanOrEqual(0.9);
      expect(r.successRate).toBeLessThanOrEqual(1);
    },
  );
});
