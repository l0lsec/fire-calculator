#!/usr/bin/env node
// T2.3 G1: the dashboard for the worked-example household shows the fixture's FI levels and dates.
// Needs the local Supabase stack (pnpm db:up).
import { playwright } from "./e2e.mjs";
import { pass } from "./lib.mjs";

playwright(["e2e/specs/dashboard.spec.ts"], ["dashboard shows the worked example's FI levels and dates"]);
pass("DASHBOARD_VERIFIED");
