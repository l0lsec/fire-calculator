// Removes TEST data only: every auth user with an @example.test email (the
// only addresses the test suites create) and the households they belong to.
// Real users and their data are never touched, so the checks can run against
// the same local stack you use day to day. Migrations are re-applied (a no-op
// when current).
import { assert, run } from "./lib.mjs";

const SQL = `
begin;
create temporary table test_users on commit drop as
  select id from auth.users where email like '%@example.test';
delete from fire.households
  where id in (select household_id from fire.household_members where user_id in (select id from test_users));
-- Households whose members are not real users (created by DB-level tests with random ids).
delete from fire.households h
  where not exists (
    select 1 from fire.household_members m join auth.users u on u.id = m.user_id where m.household_id = h.id
  );
delete from fire.sync_events where household_id is null;
delete from auth.users where id in (select id from test_users);
select 'TEST_DATA_REMOVED';
commit;
`;

export function cleanDatabase() {
  const r = run("docker", [
    "exec",
    "-i",
    "supabase_db_fire-calculator",
    "psql",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    SQL,
  ]);
  assert(r.out.includes("TEST_DATA_REMOVED"), "test data cleanup failed");
  const m = run("pnpm", ["-s", "db:migrate"]);
  assert(m.out.includes("MIGRATIONS_APPLIED"), "migrations did not apply");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  cleanDatabase();
  console.log("CLEAN_OK");
}
