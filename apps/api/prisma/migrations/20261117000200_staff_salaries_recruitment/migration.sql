-- Staff profiles replace employee records; recruitment gets custom forms, interviews and hiring
-- details; salary structures, allowances and deductions.

-- Data changes below must see every company's rows even where row-level security is forced.
SELECT set_config('app.platform', 'on', true);

-- ---- Employee -> staff profile ------------------------------------------------------------------
ALTER TYPE "EmployeeRole" RENAME TO "StaffJob";
ALTER TYPE "EmployeeStatus" RENAME TO "StaffStatus";
ALTER TABLE "employees" RENAME TO "staff_profiles";
ALTER TABLE "staff_profiles" RENAME COLUMN "employee_number" TO "staff_number";
ALTER TABLE "driver_licences" RENAME COLUMN "employee_id" TO "staff_id";
ALTER TABLE "trip_crew" RENAME COLUMN "employee_id" TO "staff_id";
ALTER TABLE "job_applications" RENAME COLUMN "employee_id" TO "staff_id";
ALTER INDEX "employees_pkey" RENAME TO "staff_profiles_pkey";
ALTER INDEX "employees_tenant_id_employee_number_key" RENAME TO "staff_profiles_tenant_id_staff_number_key";
ALTER INDEX "employees_tenant_id_id_key" RENAME TO "staff_profiles_tenant_id_id_key";
ALTER INDEX "driver_licences_tenant_id_employee_id_idx" RENAME TO "driver_licences_tenant_id_staff_id_idx";
ALTER INDEX "trip_crew_tenant_id_employee_id_idx" RENAME TO "trip_crew_tenant_id_staff_id_idx";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "employees_tenant_id_fkey" TO "staff_profiles_tenant_id_fkey";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "employees_number_chk" TO "staff_profiles_number_chk";
ALTER TABLE "staff_profiles" RENAME CONSTRAINT "employees_name_chk" TO "staff_profiles_name_chk";
ALTER TABLE "driver_licences" RENAME CONSTRAINT "driver_licences_tenant_id_employee_id_fkey" TO "driver_licences_tenant_id_staff_id_fkey";
ALTER TABLE "trip_crew" RENAME CONSTRAINT "trip_crew_tenant_id_employee_id_fkey" TO "trip_crew_tenant_id_staff_id_fkey";
ALTER POLICY "employees_isolation" ON "staff_profiles" RENAME TO "staff_profiles_isolation";
ALTER TABLE "staff_profiles" ADD COLUMN "employment" JSONB;

-- ---- Recruitment ---------------------------------------------------------------------------------
-- A posting recruits for one of the company's own roles (never the owner role) instead of a fixed
-- list of jobs. Old postings are mapped to the closest default role where the company has it.
ALTER TABLE "job_postings" ADD COLUMN "role_key" TEXT;
ALTER TABLE "job_postings" ADD COLUMN "form_fields" JSONB NOT NULL DEFAULT '[]';
UPDATE "job_postings" p SET "role_key" = CASE
    WHEN p."job_role" IN ('DRIVER', 'CONDUCTOR') THEN 'driver'
    WHEN p."job_role" = 'DISPATCHER' THEN 'dispatcher'
    ELSE NULL END
  WHERE EXISTS (
    SELECT 1 FROM "roles" r WHERE r."tenant_id" = p."tenant_id" AND r."key" = CASE
      WHEN p."job_role" IN ('DRIVER', 'CONDUCTOR') THEN 'driver'
      WHEN p."job_role" = 'DISPATCHER' THEN 'dispatcher'
      ELSE '-' END);
ALTER TABLE "job_postings" DROP COLUMN "job_role";
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_role_chk" CHECK ("role_key" IS NULL OR "role_key" <> 'owner');

ALTER TABLE "job_applications" ADD COLUMN "years_experience" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "job_applications" ADD COLUMN "form_answers" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "job_applications" ADD COLUMN "interview" JSONB;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_years_chk" CHECK ("years_experience" BETWEEN 0 AND 70);
-- "Make an offer" is gone from the pipeline: an application that was at that step is back at the interview.
UPDATE "job_applications" SET "status" = 'INTERVIEW' WHERE "status" = 'OFFERED';

ALTER TABLE "stored_files" ADD COLUMN "field_key" TEXT;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_field_key_chk" CHECK ("field_key" IS NULL OR char_length("field_key") <= 60);
-- One live licence photo and one live picture per application; one live file per custom form field.
CREATE UNIQUE INDEX "stored_files_one_live_applicant_file" ON "stored_files"("owner_id", "kind")
  WHERE "kind" IN ('APPLICATION_LICENCE', 'APPLICATION_PHOTO') AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "stored_files_one_live_form_file" ON "stored_files"("owner_id", "field_key")
  WHERE "kind" = 'APPLICATION_FORM_FILE' AND "deleted_at" IS NULL;

-- Interview and hiring notices carry their details, so a notice may be longer.
ALTER TABLE "inbox_notifications" DROP CONSTRAINT "inbox_notifications_len_chk";
ALTER TABLE "inbox_notifications" ADD CONSTRAINT "inbox_notifications_len_chk" CHECK (char_length("title") <= 120 AND char_length("body") <= 3000);

-- ---- Salaries -----------------------------------------------------------------------------------
CREATE TYPE "DeductionKind" AS ENUM ('FIXED', 'PERCENT');

CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_minor" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "salary_allowances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    CONSTRAINT "salary_allowances_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "salary_deductions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DeductionKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salary_deductions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "staff_salaries" (
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "staff_salaries_pkey" PRIMARY KEY ("tenant_id", "staff_id")
);
CREATE TABLE "staff_deductions" (
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "deduction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_deductions_pkey" PRIMARY KEY ("staff_id", "deduction_id")
);

CREATE UNIQUE INDEX "salary_structures_tenant_id_id_key" ON "salary_structures"("tenant_id", "id");
CREATE UNIQUE INDEX "salary_structures_tenant_id_name_key" ON "salary_structures"("tenant_id", "name");
CREATE INDEX "salary_allowances_tenant_id_structure_id_idx" ON "salary_allowances"("tenant_id", "structure_id");
CREATE UNIQUE INDEX "salary_deductions_tenant_id_id_key" ON "salary_deductions"("tenant_id", "id");
CREATE UNIQUE INDEX "salary_deductions_tenant_id_name_key" ON "salary_deductions"("tenant_id", "name");
CREATE INDEX "staff_salaries_tenant_id_structure_id_idx" ON "staff_salaries"("tenant_id", "structure_id");
CREATE INDEX "staff_deductions_tenant_id_deduction_id_idx" ON "staff_deductions"("tenant_id", "deduction_id");

ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_allowances" ADD CONSTRAINT "salary_allowances_tenant_id_structure_id_fkey" FOREIGN KEY ("tenant_id", "structure_id") REFERENCES "salary_structures"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_deductions" ADD CONSTRAINT "salary_deductions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_tenant_id_structure_id_fkey" FOREIGN KEY ("tenant_id", "structure_id") REFERENCES "salary_structures"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_deductions" ADD CONSTRAINT "staff_deductions_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_deductions" ADD CONSTRAINT "staff_deductions_tenant_id_deduction_id_fkey" FOREIGN KEY ("tenant_id", "deduction_id") REFERENCES "salary_deductions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_chk" CHECK (char_length(btrim("name")) BETWEEN 2 AND 80 AND "base_minor" BETWEEN 0 AND 2000000000);
ALTER TABLE "salary_allowances" ADD CONSTRAINT "salary_allowances_chk" CHECK (char_length(btrim("name")) BETWEEN 2 AND 80 AND "amount_minor" BETWEEN 0 AND 2000000000);
ALTER TABLE "salary_deductions" ADD CONSTRAINT "salary_deductions_chk" CHECK (
  char_length(btrim("name")) BETWEEN 2 AND 80
  AND (("kind" = 'FIXED' AND "value" BETWEEN 0 AND 2000000000) OR ("kind" = 'PERCENT' AND "value" BETWEEN 0 AND 10000)));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salary_structures','salary_allowances','salary_deductions','staff_salaries','staff_deductions'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "salary_structures", "salary_allowances", "salary_deductions", "staff_salaries", "staff_deductions" TO nts_app;
  END IF;
END $$;

-- 'salary.manage' is new: company owners and finance officers manage salaries. Roles keep their
-- permissions as rows, so grant it where it is missing (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'salary.manage' FROM "roles" r WHERE r."key" IN ('owner', 'finance_officer')
ON CONFLICT DO NOTHING;
