# Historical data

`us-monthly.json` (not yet present) is built by `scripts/data/build-us-monthly.mjs` from Robert
Shiller's public U.S. stock market dataset (monthly S&P composite price and dividends, CPI, and
the 10-year long interest rate, 1871 onward), as published by Yale and mirrored as CSV in the
open "datasets/s-and-p-500" collection.

Derived series (monthly, decimal):

- stocks: (P[t] + D[t] / 12) / P[t-1] - 1 (price plus dividend yield, total return)
- bonds: a 10-year par bond's return from the long rate: y[t-1] / 12 minus modified duration
  times the change in yield (duration from the 10-year annuity formula)
- inflation: CPI[t] / CPI[t-1] - 1

These are the standard approximations used in historical safe-withdrawal-rate studies. The data
is public; cite Shiller when sharing results.
