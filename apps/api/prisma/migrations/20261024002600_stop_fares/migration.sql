-- Phase 21: prices set by stop. A route may carry a price for each pair of stops along it (get on
-- at one, get off at a later one). Where a pair has no price the route's own fare still applies.

CREATE TABLE "stop_fares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stop_fares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stop_fares_pair_key" ON "stop_fares"("route_id", "from_location_id", "to_location_id");
CREATE INDEX "stop_fares_tenant_route_idx" ON "stop_fares"("tenant_id", "route_id");
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_route_fkey" FOREIGN KEY ("tenant_id", "route_id") REFERENCES "routes"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_from_fkey" FOREIGN KEY ("tenant_id", "from_location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_to_fkey" FOREIGN KEY ("tenant_id", "to_location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_amount_chk" CHECK ("amount_minor" >= 0);
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "stop_fares" ADD CONSTRAINT "stop_fares_distinct_chk" CHECK ("from_location_id" <> "to_location_id");

ALTER TABLE "stop_fares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stop_fares" FORCE ROW LEVEL SECURITY;
CREATE POLICY "stop_fares_isolation" ON "stop_fares"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

-- A booking remembers where the passengers get on and off, when the price was set by stop.
ALTER TABLE "bookings" ADD COLUMN "boarding_location_id" UUID;
ALTER TABLE "bookings" ADD COLUMN "alighting_location_id" UUID;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_boarding_fkey" FOREIGN KEY ("tenant_id", "boarding_location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_alighting_fkey" FOREIGN KEY ("tenant_id", "alighting_location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stops_chk" CHECK (("boarding_location_id" IS NULL) = ("alighting_location_id" IS NULL));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    REVOKE ALL ON "stop_fares" FROM nts_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stop_fares" TO nts_app;
  END IF;
END $$;
