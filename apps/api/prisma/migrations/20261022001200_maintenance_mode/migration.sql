-- Phase 9: platform settings (maintenance mode).
-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maintenance_enabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_message" TEXT,
    "maintenance_since" TIMESTAMPTZ(6),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);


-- Exactly one row, and enabling maintenance must carry a message and a start time.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_singleton_chk" CHECK ("id" = 'singleton');
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_maintenance_chk"
  CHECK (NOT "maintenance_enabled" OR ("maintenance_message" IS NOT NULL AND "maintenance_since" IS NOT NULL));
INSERT INTO "platform_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;

-- Every request reads this row (the gate), so anyone may SELECT; only platform scope may change it.
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "platform_settings_read" ON "platform_settings" FOR SELECT USING (true);
CREATE POLICY "platform_settings_write" ON "platform_settings" FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, UPDATE ON "platform_settings" TO nts_app;
  END IF;
END $$;
