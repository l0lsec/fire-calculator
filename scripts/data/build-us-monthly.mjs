#!/usr/bin/env node
// Builds packages/engine/data/us-monthly.json from a Shiller-format monthly CSV
// with columns Date, SP500, Dividend, Consumer Price Index, Long Interest Rate
// (the datasets/s-and-p-500 "data.csv" layout). See packages/engine/data/SOURCES.md.
// Usage: node scripts/data/build-us-monthly.mjs <input.csv> [output.json]
import { readFileSync, writeFileSync } from "node:fs";

export function buildSeries(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  const col = (name) => {
    const i = head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`missing column ${name}`);
    return i;
  };
  const iDate = col("Date");
  const iP = col("SP500");
  const iD = col("Dividend");
  const iCpi = col("Consumer Price Index");
  const iY = col("Long Interest Rate");
  const rows = lines
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => ({
      date: c[iDate].trim().slice(0, 7),
      p: Number(c[iP]),
      d: Number(c[iD]),
      cpi: Number(c[iCpi]),
      y: Number(c[iY]) / 100,
    }))
    .filter((r) => r.p > 0 && r.cpi > 0 && Number.isFinite(r.d) && r.y > 0);
  const dur = (y) => (1 - (1 + y) ** -10) / y;
  const stocks = [];
  const bonds = [];
  const inflation = [];
  for (let t = 1; t < rows.length; t++) {
    const a = rows[t - 1];
    const b = rows[t];
    stocks.push((b.p + b.d / 12) / a.p - 1);
    bonds.push(a.y / 12 - dur(a.y) * (b.y - a.y));
    inflation.push(b.cpi / a.cpi - 1);
  }
  return { start: rows[1].date, stocks, bonds, inflation };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [input, output = "packages/engine/data/us-monthly.json"] = process.argv.slice(2);
  if (!input) {
    console.error("usage: build-us-monthly.mjs <input.csv> [output.json]");
    process.exit(2);
  }
  const series = buildSeries(readFileSync(input, "utf8"));
  writeFileSync(output, JSON.stringify(series));
  console.log(`wrote ${output}: ${series.stocks.length} months from ${series.start}`);
}
