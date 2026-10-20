-- Phase 4 slice B: employees, licences, trip crew, maintenance, vehicle documents.
-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('DRIVER', 'CONDUCTOR', 'DISPATCHER', 'MECHANIC', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "CrewRole" AS ENUM ('DRIVER', 'CONDUCTOR');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('SERVICE', 'REPAIR', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleDocumentKind" AS ENUM ('INSURANCE', 'INSPECTION_CERTIFICATE', 'ROAD_LICENCE', 'OTHER');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "crew_min_rest_minutes" INTEGER NOT NULL DEFAULT 480;

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "EmployeeRole" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "hired_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_licences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "licence_number" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "expires_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_crew" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" "CrewRole" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" "MaintenanceKind" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_for" DATE NOT NULL,
    "completed_on" DATE,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "odometer_km" INTEGER,
    "cost_minor" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" "VehicleDocumentKind" NOT NULL,
    "reference_no" TEXT NOT NULL,
    "expires_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_number_key" ON "employees"("tenant_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_id_key" ON "employees"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "driver_licences_tenant_id_employee_id_idx" ON "driver_licences"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_licences_tenant_id_licence_number_key" ON "driver_licences"("tenant_id", "licence_number");

-- CreateIndex
CREATE INDEX "trip_crew_tenant_id_trip_id_idx" ON "trip_crew"("tenant_id", "trip_id");

-- CreateIndex
CREATE INDEX "trip_crew_tenant_id_employee_id_idx" ON "trip_crew"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "maintenance_records_tenant_id_vehicle_id_idx" ON "maintenance_records"("tenant_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "maintenance_records_tenant_id_status_scheduled_for_idx" ON "maintenance_records"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "vehicle_documents_tenant_id_expires_on_idx" ON "vehicle_documents"("tenant_id", "expires_on");

-- CreateIndex
CREATE INDEX "vehicle_documents_tenant_id_vehicle_id_idx" ON "vehicle_documents"("tenant_id", "vehicle_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_licences" ADD CONSTRAINT "driver_licences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_licences" ADD CONSTRAINT "driver_licences_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_tenant_id_trip_id_fkey" FOREIGN KEY ("tenant_id", "trip_id") REFERENCES "trips"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written additions: data-shape guards, duty-overlap prevention, partial uniqueness, RLS.
-- =============================================================================================

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_crew_rest_chk" CHECK ("crew_min_rest_minutes" BETWEEN 0 AND 1440);

ALTER TABLE "employees" ADD CONSTRAINT "employees_number_chk" CHECK (length(btrim("employee_number")) BETWEEN 1 AND 30);
ALTER TABLE "employees" ADD CONSTRAINT "employees_name_chk" CHECK (length(btrim("full_name")) BETWEEN 2 AND 120);

ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_window_chk" CHECK ("ends_at" > "starts_at");

-- An employee cannot be on two overlapping duties (the database enforces it, so two dispatchers
-- racing cannot double-book a driver). Released assignments no longer count. Back-to-back is fine.
ALTER TABLE "trip_crew" ADD CONSTRAINT "trip_crew_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "employee_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("released_at" IS NULL);

-- The same person cannot hold two live assignments on one trip.
CREATE UNIQUE INDEX "trip_crew_active_unique" ON "trip_crew"("trip_id", "employee_id") WHERE "released_at" IS NULL;

ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_cost_chk" CHECK ("cost_minor" IS NULL OR "cost_minor" >= 0);
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_odometer_chk" CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0);
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_completion_chk" CHECK (("status" = 'COMPLETED') = ("completed_on" IS NOT NULL));
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_description_chk" CHECK (length(btrim("description")) BETWEEN 2 AND 500);
-- A vehicle can be in the workshop for only one job at a time.
CREATE UNIQUE INDEX "maintenance_one_in_progress" ON "maintenance_records"("vehicle_id") WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_ref_chk" CHECK (length(btrim("reference_no")) BETWEEN 1 AND 60);

-- Row-level security: tenant or platform scope only ---------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','driver_licences','trip_crew','maintenance_records','vehicle_documents'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "employees", "driver_licences", "trip_crew", "maintenance_records", "vehicle_documents" TO nts_app;
  END IF;
END $$;
