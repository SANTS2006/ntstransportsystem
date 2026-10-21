-- Phase 5A: fares, bookings, atomic seat inventory.
-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "fares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "service_class" TEXT NOT NULL DEFAULT 'STANDARD',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "total_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT,
    "request_hash" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_passengers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_label" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "fare_minor" INTEGER NOT NULL,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "booking_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fares_tenant_id_route_id_service_class_key" ON "fares"("tenant_id", "route_id", "service_class");

-- CreateIndex
CREATE UNIQUE INDEX "fares_tenant_id_id_key" ON "fares"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "bookings_tenant_id_trip_id_idx" ON "bookings"("tenant_id", "trip_id");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_reference_key" ON "bookings"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_idempotency_key_key" ON "bookings"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_id_key" ON "bookings"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "booking_passengers_tenant_id_booking_id_idx" ON "booking_passengers"("tenant_id", "booking_id");

-- CreateIndex
CREATE INDEX "booking_passengers_tenant_id_trip_id_idx" ON "booking_passengers"("tenant_id", "trip_id");

-- CreateIndex
CREATE INDEX "booking_status_history_tenant_id_booking_id_created_at_idx" ON "booking_status_history"("tenant_id", "booking_id", "created_at");

-- AddForeignKey
ALTER TABLE "fares" ADD CONSTRAINT "fares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fares" ADD CONSTRAINT "fares_tenant_id_route_id_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_trip_id_fkey" FOREIGN KEY ("tenant_id", "trip_id") REFERENCES "trips"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money is integer minor units, never negative; currency is an ISO-4217 style code.
ALTER TABLE "fares" ADD CONSTRAINT "fares_amount_chk" CHECK ("amount_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_chk" CHECK ("total_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_fare_chk" CHECK ("fare_minor" >= 0);

-- Atomic seat inventory: a seat on a trip can be held by at most one live booking passenger.
-- Concurrent claims race on this index; exactly one INSERT wins, the rest get a unique violation.
CREATE UNIQUE INDEX "booking_passengers_live_seat_key" ON "booking_passengers"("trip_id", "seat_label") WHERE "released_at" IS NULL;

-- Status history is append-only.
CREATE OR REPLACE FUNCTION booking_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'booking_status_history is append-only'; END $$;
CREATE TRIGGER booking_history_no_update BEFORE UPDATE ON "booking_status_history"
  FOR EACH ROW EXECUTE FUNCTION booking_history_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fares','bookings','booking_passengers','booking_status_history'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "fares", "bookings", "booking_passengers", "booking_status_history" TO nts_app;
    REVOKE DELETE ON "booking_status_history" FROM nts_app;
  END IF;
END $$;
