-- Phase 4 slice C: service calendars, seat layouts, route/vehicle compatibility, trip timeline, outbox.
-- CreateEnum
CREATE TYPE "TripEventKind" AS ENUM ('STATUS_CHANGED', 'DELAY_SET', 'VEHICLE_ASSIGNED', 'VEHICLE_REPLACED', 'CREW_ASSIGNED', 'CREW_RELEASED', 'NOTE');

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "allowed_vehicle_types" "VehicleType"[] DEFAULT ARRAY[]::"VehicleType"[],
ADD COLUMN     "min_seats" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "seat_layout_id" UUID;

-- CreateTable
CREATE TABLE "service_blackouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_layout_seats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "col_no" INTEGER NOT NULL,
    "accessible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "seat_layout_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "kind" "TripEventKind" NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_blackouts_tenant_id_starts_on_ends_on_idx" ON "service_blackouts"("tenant_id", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layouts_tenant_id_name_key" ON "seat_layouts"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layouts_tenant_id_id_key" ON "seat_layouts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "seat_layout_seats_tenant_id_layout_id_idx" ON "seat_layout_seats"("tenant_id", "layout_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_layout_seats_layout_id_label_key" ON "seat_layout_seats"("layout_id", "label");

-- CreateIndex
CREATE INDEX "trip_events_tenant_id_trip_id_created_at_idx" ON "trip_events"("tenant_id", "trip_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_failed_at_available_at_idx" ON "outbox_events"("processed_at", "failed_at", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenant_id_dedupe_key_key" ON "outbox_events"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_seat_layout_id_fkey" FOREIGN KEY ("tenant_id", "seat_layout_id") REFERENCES "seat_layouts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_blackouts" ADD CONSTRAINT "service_blackouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_blackouts" ADD CONSTRAINT "service_blackouts_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layouts" ADD CONSTRAINT "seat_layouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layout_seats" ADD CONSTRAINT "seat_layout_seats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_layout_seats" ADD CONSTRAINT "seat_layout_seats_tenant_id_layout_id_fkey" FOREIGN KEY ("tenant_id", "layout_id") REFERENCES "seat_layouts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_tenant_id_trip_id_fkey" FOREIGN KEY ("tenant_id", "trip_id") REFERENCES "trips"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written additions for slice C.
-- =============================================================================================

ALTER TABLE "service_blackouts" ADD CONSTRAINT "service_blackouts_range_chk" CHECK ("ends_on" >= "starts_on");
ALTER TABLE "service_blackouts" ADD CONSTRAINT "service_blackouts_reason_chk" CHECK (length(btrim("reason")) BETWEEN 2 AND 200);
ALTER TABLE "routes" ADD CONSTRAINT "routes_min_seats_chk" CHECK ("min_seats" BETWEEN 1 AND 200);
ALTER TABLE "seat_layout_seats" ADD CONSTRAINT "seat_layout_seats_pos_chk" CHECK ("row_no" >= 1 AND "col_no" >= 1);
ALTER TABLE "seat_layout_seats" ADD CONSTRAINT "seat_layout_seats_label_chk" CHECK (length(btrim("label")) BETWEEN 1 AND 8);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_attempts_chk" CHECK ("attempts" >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_final_state_chk" CHECK (NOT ("processed_at" IS NOT NULL AND "failed_at" IS NOT NULL));

-- The worker scans only live rows, so index only those.
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("available_at") WHERE "processed_at" IS NULL AND "failed_at" IS NULL;

-- The trip timeline is append-only: history is never rewritten.
CREATE OR REPLACE FUNCTION trip_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'trip_events is append-only'; END $$;
CREATE TRIGGER trip_events_no_update BEFORE UPDATE ON "trip_events"
  FOR EACH ROW EXECUTE FUNCTION trip_events_immutable();

-- Row-level security: tenant or platform scope only (the outbox worker runs in platform scope).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_blackouts','seat_layouts','seat_layout_seats','trip_events','outbox_events'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "service_blackouts", "seat_layouts", "seat_layout_seats", "trip_events", "outbox_events" TO nts_app;
    REVOKE DELETE ON "trip_events" FROM nts_app;
  END IF;
END $$;
