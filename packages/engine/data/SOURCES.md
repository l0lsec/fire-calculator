# Historical data

`us-monthly.json` is built by `scripts/data/build-us-monthly.mjs` from Robert
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

## Current build

- Source file: `data.csv` from github.com/datasets/s-and-p-500 (`data/data.csv`), 123,851 bytes,
  SHA-256 `b797a3c8de4586af837b86a156b05f49be11ffab99e13171dae763b2a11bdf79`, fetched 2026-11-25.
- Complete months used: 1871-02 to 2023-06 (later rows lack dividend, CPI and rate data).
- Check: 4% inflation-adjusted, 30 years, 60/40 succeeds in 95.9% of 123 rolling yearly starts;
  the failures are the 1965 to 1969 starts, matching the published historical studies.
