#!/usr/bin/env node
// T0.2 G3: token encryption round-trips, rejects tampering and moved rows, rotates keys.
import { pass, vitest } from "./lib.mjs";

vitest(
  ["packages/db/test/db.test.ts"],
  ["round-trips, rejects tampering and wrong rows, and rotates keys", "rejects malformed key specs"],
);
pass("CRYPTO_VERIFIED");
