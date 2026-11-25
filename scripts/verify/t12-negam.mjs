#!/usr/bin/env node
// T1.2 G3: a minimum below interest warns and the simulation terminates.
import { pass, vitest } from "./lib.mjs";

vitest(["packages/engine/test/debt/debt.test.ts"], ["a minimum below interest warns and terminates"]);
pass("NEGAM_VERIFIED");
