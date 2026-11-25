#!/usr/bin/env node
// T2.1 G2: invalid input (negative balance, APR over 100%) is rejected server side with field errors.
import { pass, vitest } from "./lib.mjs";

vitest(["apps/web/test/manual.test.ts"], ["invalid input is rejected server side with field errors"]);
pass("MANUAL_VALIDATION_VERIFIED");
