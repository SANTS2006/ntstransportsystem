-- Phase 8: notification delivery log, and a permission backfill.
-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "recipient_key" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_tenant_id_sent_at_idx" ON "notification_deliveries"("tenant_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_outbox_event_id_recipient_key_key" ON "notification_deliveries"("outbox_event_id", "recipient_key");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_deliveries_isolation" ON "notification_deliveries"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT ON "notification_deliveries" TO nts_app;
  END IF;
END $$;

-- 'payment.manage' was added after some companies were created. Owner and admin roles keep their
-- permissions as rows, so grant it to those roles where it is missing (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'payment.manage' FROM "roles" r WHERE r."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
