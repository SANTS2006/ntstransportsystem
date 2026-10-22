-- Phase 7: tickets and boarding.
-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('ISSUED', 'BOARDED', 'VOID');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_label" TEXT NOT NULL,
    "passenger_name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boarded_at" TIMESTAMPTZ(6),
    "boarded_by_user_id" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_passenger_id_key" ON "tickets"("passenger_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_trip_id_idx" ON "tickets"("tenant_id", "trip_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_booking_id_idx" ON "tickets"("tenant_id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_code_key" ON "tickets"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "booking_passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A ticket is only ever voided with a reason, and a boarded ticket records who boarded it.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_void_chk" CHECK (("status" = 'VOID') = ("voided_at" IS NOT NULL));
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_boarded_chk" CHECK (("status" = 'BOARDED') = ("boarded_at" IS NOT NULL));

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tickets_isolation" ON "tickets"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "tickets" TO nts_app;
  END IF;
END $$;
