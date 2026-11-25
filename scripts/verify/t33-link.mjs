#!/usr/bin/env node
// T3.3 G1 (real Plaid Sandbox): a Sandbox Link completes, the stored token decrypts,
// and no response or log line contains it. Needs PLAID_CLIENT_ID/PLAID_SECRET (sandbox) in .env.
import { pass, vitest } from "./lib.mjs";

vitest(["apps/web/test/sandbox.test.ts"], ["a Sandbox Link completes and the stored token decrypts"]);
pass("LINK_VERIFIED");
