-- Defense in depth for household data (BUILD_PLAN section 12).
--
-- The app reaches these tables only through its own server connection, as the
-- schema owner, and scopes every query by household in the repository layer.
-- Supabase's API roles (anon, authenticated) and PUBLIC get no privileges, and
-- row level security is enabled with no permissive policies, so a leaked anon
-- key or a mistaken grant still returns zero rows. Later migrations that add
-- tables must end with: SELECT fire.lock_down();
CREATE OR REPLACE FUNCTION fire.lock_down() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'fire' LOOP
    EXECUTE format('ALTER TABLE fire.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE fire.%I FROM PUBLIC', t.tablename);
  END LOOP;
  EXECUTE 'REVOKE ALL ON SCHEMA fire FROM PUBLIC';
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA fire FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fire FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA fire FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fire FROM %I', r);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
SELECT fire.lock_down();
