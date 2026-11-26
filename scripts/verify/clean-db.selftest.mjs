#!/usr/bin/env node
// Negative control for the test-data cleanup: a user who is NOT an @example.test
// account, and that user's household, must survive it. Uses throwaway rows it
// creates and removes itself.
import { randomUUID } from "node:crypto";
import { cleanDatabase } from "./clean-db.mjs";
import { assert, run } from "./lib.mjs";

const sql = (q) =>
  run(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_fire-calculator",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      q,
    ],
    { quiet: true },
  ).out.trim();
const uid = randomUUID();
const hid = randomUUID();
sql(`insert into auth.users (id, email, aud, role) values ('${uid}', 'keeper-${uid.slice(0, 8)}@keep.invalid', 'authenticated', 'authenticated');
     insert into fire.households (id, name) values ('${hid}', 'Keeper');
     insert into fire.household_members (household_id, user_id) values ('${hid}', '${uid}');`);
try {
  cleanDatabase();
  assert(
    sql(`select count(*) from auth.users where id = '${uid}'`) === "1",
    "cleanup deleted a non-test user",
  );
  assert(
    sql(`select count(*) from fire.households where id = '${hid}'`) === "1",
    "cleanup deleted a non-test household",
  );
} finally {
  sql(`delete from fire.households where id = '${hid}'; delete from auth.users where id = '${uid}';`);
}
console.log("CLEAN_SELFTEST_OK");
