-- Phase 4: transport catalog and fleet (locations, vehicles, routes, stops, schedules, trips).
-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('TERMINAL', 'STATION', 'STOP', 'DEPOT');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BUS', 'MINIBUS', 'SHARED_TAXI', 'TAXI', 'SHUTTLE', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'BOARDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL DEFAULT 'TERMINAL',
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "roleId" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registration" TEXT NOT NULL,
    "label" TEXT,
    "type" "VehicleType" NOT NULL DEFAULT 'BUS',
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "seating_capacity" INTEGER NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "odometer_km" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "roleId" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "origin_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "roleId" UUID,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "offset_min" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roleId" UUID,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "departure_time" TEXT NOT NULL,
    "days_of_week" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "default_vehicle_id" UUID,
    "service_class" TEXT,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "roleId" UUID,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "schedule_id" UUID,
    "route_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "departure_at" TIMESTAMPTZ(6) NOT NULL,
    "arrival_at" TIMESTAMPTZ(6) NOT NULL,
    "vehicle_id" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "roleId" UUID,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_name_key" ON "locations"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_id_key" ON "locations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_registration_key" ON "vehicles"("tenant_id", "registration");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_id_key" ON "vehicles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_tenant_id_name_key" ON "routes"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "routes_tenant_id_id_key" ON "routes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_sequence_key" ON "route_stops"("route_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_location_id_key" ON "route_stops"("route_id", "location_id");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_route_id_idx" ON "schedules"("tenant_id", "route_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_id_key" ON "schedules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "trips_tenant_id_departure_at_idx" ON "trips"("tenant_id", "departure_at");

-- CreateIndex
CREATE UNIQUE INDEX "trips_schedule_id_service_date_key" ON "trips"("schedule_id", "service_date");

-- CreateIndex
CREATE UNIQUE INDEX "trips_tenant_id_id_key" ON "trips"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_origin_id_fkey" FOREIGN KEY ("tenant_id", "origin_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_destination_id_fkey" FOREIGN KEY ("tenant_id", "destination_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_default_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "default_vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written additions: data-shape guards, overlap prevention, and row-level security.
-- =============================================================================================

-- Needed so a GiST exclusion constraint can combine equality on uuid with range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Data-shape guards ---------------------------------------------------------------------------
ALTER TABLE "locations" ADD CONSTRAINT "locations_lat_chk" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);
ALTER TABLE "locations" ADD CONSTRAINT "locations_lng_chk" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);
ALTER TABLE "locations" ADD CONSTRAINT "locations_coords_pair_chk" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_registration_norm_chk" CHECK ("registration" = upper(btrim("registration")) AND length("registration") BETWEEN 2 AND 20);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_capacity_chk" CHECK ("seating_capacity" BETWEEN 1 AND 200);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_year_chk" CHECK ("year" IS NULL OR "year" BETWEEN 1950 AND 2100);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_odometer_chk" CHECK ("odometer_km" >= 0);

ALTER TABLE "routes" ADD CONSTRAINT "routes_distinct_ends_chk" CHECK ("origin_id" <> "destination_id");
ALTER TABLE "routes" ADD CONSTRAINT "routes_distance_chk" CHECK ("distance_m" > 0);
ALTER TABLE "routes" ADD CONSTRAINT "routes_duration_chk" CHECK ("duration_min" > 0);

ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_sequence_chk" CHECK ("sequence" >= 1);
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_offset_chk" CHECK ("offset_min" >= 0);

ALTER TABLE "schedules" ADD CONSTRAINT "schedules_time_chk" CHECK ("departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_days_chk" CHECK ("days_of_week" BETWEEN 1 AND 127);
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_validity_chk" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");

ALTER TABLE "trips" ADD CONSTRAINT "trips_times_chk" CHECK ("arrival_at" > "departure_at");
ALTER TABLE "trips" ADD CONSTRAINT "trips_delay_chk" CHECK ("delay_minutes" >= 0);

-- A vehicle cannot be on two overlapping, non-cancelled trips (the database enforces it, so races
-- between two dispatchers cannot double-book a vehicle). Half-open ranges: back-to-back is fine.
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "vehicle_id" WITH =,
    tstzrange("departure_at", "arrival_at", '[)') WITH &&
  ) WHERE ("vehicle_id" IS NOT NULL AND "status" <> 'CANCELLED');

-- Row-level security: tenant or platform scope only ---------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations','vehicles','routes','route_stops','schedules','trips'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenant_id" = app_tenant_id() OR app_is_platform()) WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Grants for the restricted application role (also covered by default privileges) -------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "locations", "vehicles", "routes", "route_stops", "schedules", "trips" TO nts_app;
  END IF;
END $$;
