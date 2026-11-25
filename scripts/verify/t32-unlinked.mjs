#!/usr/bin/env node
// T3.2 G2: a payment to an unlinked card counts as spending and is flagged.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/spending/test/spending.test.ts"],
  ["a payment to an unlinked card counts as spending and is flagged"],
);
pass("UNLINKED_CARD_VERIFIED");
