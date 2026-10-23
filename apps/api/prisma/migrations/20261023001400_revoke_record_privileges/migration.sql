-- Corrective: migration 20261020000200 set default privileges that give the application role
-- DELETE (and UPDATE) on every table created afterwards. Tables that are records (never edited or
-- removed through the application) must not inherit that.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    -- Written once, never changed or removed.
    REVOKE UPDATE, DELETE ON "complaint_messages", "trip_ratings", "notification_deliveries" FROM nts_app;
    -- Changed through the app (status), but never removed.
    REVOKE DELETE ON "tickets", "complaints" FROM nts_app;
    -- A single row that is only ever updated.
    REVOKE INSERT, DELETE ON "platform_settings" FROM nts_app;

    -- From now on a new table gets no DELETE by default: a migration must grant it on purpose.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE DELETE ON TABLES FROM nts_app;
  END IF;
END $$;
