-- Phase 10: complaints, their conversation, and trip ratings.
-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('DELAY', 'VEHICLE', 'STAFF_CONDUCT', 'REFUND', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ComplaintAuthor" AS ENUM ('PASSENGER', 'STAFF');

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_kind" "ComplaintAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "complaints_tenant_id_status_created_at_idx" ON "complaints"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "complaints_user_id_created_at_idx" ON "complaints"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_tenant_id_id_key" ON "complaints"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "complaint_messages_tenant_id_complaint_id_created_at_idx" ON "complaint_messages"("tenant_id", "complaint_id", "created_at");

-- CreateIndex
CREATE INDEX "trip_ratings_tenant_id_trip_id_idx" ON "trip_ratings"("tenant_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_ratings_booking_id_key" ON "trip_ratings"("booking_id");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_tenant_id_complaint_id_fkey" FOREIGN KEY ("tenant_id", "complaint_id") REFERENCES "complaints"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_ratings" ADD CONSTRAINT "trip_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_ratings" ADD CONSTRAINT "trip_ratings_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "complaints" ADD CONSTRAINT "complaints_subject_chk" CHECK (char_length("subject") BETWEEN 3 AND 150);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_chk" CHECK (("status" IN ('RESOLVED', 'CLOSED')) = ("resolved_at" IS NOT NULL));
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_body_chk" CHECK (char_length("body") BETWEEN 1 AND 4000);
ALTER TABLE "trip_ratings" ADD CONSTRAINT "trip_ratings_rating_chk" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "trip_ratings" ADD CONSTRAINT "trip_ratings_comment_chk" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);

-- The conversation is a record: messages are never edited or removed.
CREATE OR REPLACE FUNCTION complaint_messages_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'complaint_messages is append-only'; END $$;
CREATE TRIGGER complaint_messages_no_update BEFORE UPDATE ON "complaint_messages"
  FOR EACH ROW EXECUTE FUNCTION complaint_messages_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['complaints','complaint_messages','trip_ratings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenant_id" = app_tenant_id() OR app_is_platform()) WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform())',
      t || '_isolation', t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "complaints" TO nts_app;
    GRANT SELECT, INSERT ON "complaint_messages", "trip_ratings" TO nts_app;
  END IF;
END $$;
