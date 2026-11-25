#!/usr/bin/env node
import { cleanDatabase } from "./clean-db.mjs";
import { playwright } from "./e2e.mjs";
// T5.2 G2: on a clean database, every e2e flow passes against the fake Plaid API:
// onboarding (manual and with a bank), spending review, debt strategy, re-auth, disconnect, delete.
import { pass } from "./lib.mjs";

cleanDatabase();
playwright(
  ["e2e/specs"],
  [
    "a manual-only household goes from sign-up to a dashboard with dates",
    "connect, sync and a verified webhook work end to end over HTTP",
    "review spending: marking a large purchase one-time lowers the annual total",
    "change debt strategy: the planner's choice is saved to the plan",
    "a login error shows Reconnect, and a repaired login clears it",
    "disconnect a bank through the UI",
    "delete my data revokes the connection, purges the household and signs out",
  ],
);
pass("E2E_FAKE_VERIFIED");
