-- Phase 12: recruitment (job postings, applications, application history).
-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "job_postings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "job_role" "EmployeeRole" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "closes_on" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "licence_number" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus",
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_postings_tenant_id_status_idx" ON "job_postings"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_postings_tenant_id_id_key" ON "job_postings"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "job_applications_tenant_id_status_created_at_idx" ON "job_applications"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "job_applications_user_id_created_at_idx" ON "job_applications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_job_id_user_id_key" ON "job_applications"("job_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_tenant_id_id_key" ON "job_applications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "application_events_tenant_id_application_id_created_at_idx" ON "application_events"("tenant_id", "application_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_tenant_id_job_id_fkey" FOREIGN KEY ("tenant_id", "job_id") REFERENCES "job_postings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "job_applications"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_title_chk" CHECK (char_length("title") BETWEEN 3 AND 120);
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_description_chk" CHECK (char_length("description") BETWEEN 20 AND 8000);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_text_chk"
  CHECK (char_length("full_name") BETWEEN 2 AND 120 AND char_length("phone") BETWEEN 6 AND 20 AND char_length("experience") BETWEEN 10 AND 4000);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_hired_chk" CHECK (("status" = 'HIRED') = ("employee_id" IS NOT NULL));
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_note_chk" CHECK ("note" IS NULL OR char_length("note") <= 2000);

-- The history of an application is a record: never edited.
CREATE OR REPLACE FUNCTION application_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'application_events is append-only'; END $$;
CREATE TRIGGER application_events_no_update BEFORE UPDATE ON "application_events"
  FOR EACH ROW EXECUTE FUNCTION application_events_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_postings','job_applications','application_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenant_id" = app_tenant_id() OR app_is_platform()) WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Explicit, minimal privileges: postings and applications change but are never removed; the
-- history is insert-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "job_postings", "job_applications" TO nts_app;
    GRANT SELECT, INSERT ON "application_events" TO nts_app;
    REVOKE DELETE ON "job_postings", "job_applications", "application_events" FROM nts_app;
    REVOKE UPDATE ON "application_events" FROM nts_app;
  END IF;
END $$;
