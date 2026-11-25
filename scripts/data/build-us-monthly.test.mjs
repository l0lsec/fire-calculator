// Self-check for the converter on a tiny synthetic CSV: node scripts/data/build-us-monthly.test.mjs
import assert from "node:assert/strict";
import { buildSeries } from "./build-us-monthly.mjs";

const csv = `Date,SP500,Dividend,Earnings,Consumer Price Index,Long Interest Rate,Real Price,Real Dividend,Real Earnings,PE10
2000-01-01,100,2.4,5,100,5.0,,,,
2000-02-01,101,2.4,5,100.5,5.0,,,,
2000-03-01,99,2.4,5,101,6.0,,,,
2000-04-01,98,0.0,0.0,0.0,0.0,,,,`;
const s = buildSeries(csv);
assert.equal(s.start, "2000-02");
assert.equal(s.stocks.length, 2);
assert.ok(Math.abs(s.stocks[0] - (101 + 0.2) / 100 + 1) < 1e-12);
assert.ok(Math.abs(s.inflation[0] - 0.005) < 1e-12);
assert.ok(Math.abs(s.bonds[0] - 0.05 / 12) < 1e-12); // unchanged yield: coupon only
assert.ok(s.bonds[1] < 0); // yield rose: price fell
assert.equal(s.end, "2000-03"); // the unpublished month is dropped
assert.throws(() => buildSeries(`${csv}\n2000-05-01,97,2.4,5,102,6.0,,,,`), /gap in the data/);
console.log("CONVERTER_OK");
