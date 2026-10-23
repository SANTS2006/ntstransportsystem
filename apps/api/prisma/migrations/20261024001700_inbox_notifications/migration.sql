-- Phase 14: in-app notifications.
-- CreateTable
CREATE TABLE "inbox_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "inbox_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbox_notifications_outbox_event_id_user_id_dedupe_key_key" ON "inbox_notifications"("outbox_event_id", "user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "inbox_notifications_user_id_created_at_idx" ON "inbox_notifications"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_link_chk" CHECK ("link" IS NULL OR "link" ~ '^/[A-Za-z0-9]');
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_len_chk" CHECK (char_length("title") <= 120 AND char_length("body") <= 500);

ALTER TABLE "inbox_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inbox_notifications_isolation" ON "inbox_notifications"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

-- Only read_at may change after insert, and rows are never removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    REVOKE ALL ON "inbox_notifications" FROM nts_app;
    GRANT SELECT, INSERT ON "inbox_notifications" TO nts_app;
    GRANT UPDATE ("read_at") ON "inbox_notifications" TO nts_app;
  END IF;
END $$;
