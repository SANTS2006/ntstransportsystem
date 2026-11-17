-- Contact messages and demo requests from the public website, read by platform administrators.
CREATE TYPE "InquiryKind" AS ENUM ('CONTACT', 'DEMO');
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'HANDLED');

CREATE TABLE "site_inquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "InquiryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "message" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_inquiries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "site_inquiries_status_created_at_idx" ON "site_inquiries"("status", "created_at" DESC);

ALTER TABLE "site_inquiries" ADD CONSTRAINT "site_inquiries_text_chk" CHECK (
  char_length("name") BETWEEN 2 AND 120 AND char_length("email") <= 254
  AND ("message" IS NULL OR char_length("message") <= 4000)
  AND ("company" IS NULL OR char_length("company") <= 120));

-- Anyone may send one; only platform scope may read or mark them.
ALTER TABLE "site_inquiries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_inquiries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "site_inquiries_insert" ON "site_inquiries" FOR INSERT WITH CHECK (true);
CREATE POLICY "site_inquiries_read" ON "site_inquiries" FOR SELECT USING (app_is_platform());
CREATE POLICY "site_inquiries_update" ON "site_inquiries" FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "site_inquiries" TO nts_app;
    REVOKE DELETE ON "site_inquiries" FROM nts_app;
  END IF;
END $$;
