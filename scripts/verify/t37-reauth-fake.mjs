#!/usr/bin/env node
// T3.7 G3: login errors show Reconnect; LOGIN_REPAIRED restores Connected (fake Plaid over HTTP).
import { playwright } from "./e2e.mjs";
import { pass, vitest } from "./lib.mjs";

vitest(
  ["apps/web/test/plaid.test.ts"],
  ["ITEM_LOGIN_REQUIRED flips the Item to login_required and a repaired login restores healthy"],
);
playwright(
  ["e2e/specs/plaid-fake.spec.ts"],
  ["a login error shows Reconnect, and a repaired login clears it"],
);
pass("REAUTH_FAKE_VERIFIED");
