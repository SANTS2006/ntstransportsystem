-- Phase 6: payments (Monime), per-company credentials, webhook replay log.
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'PAID_UNFULFILLED');

-- CreateTable
CREATE TABLE "payment_settings" (
    "tenant_id" UUID NOT NULL,
    "space_id" TEXT NOT NULL,
    "api_token_enc" TEXT NOT NULL,
    "webhook_secret_enc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MONIME',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "provider_session_id" TEXT,
    "redirect_url" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenant_id_booking_id_idx" ON "payments"("tenant_id", "booking_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_provider_session_id_idx" ON "payments"("tenant_id", "provider_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_tenant_id_event_id_key" ON "payment_webhook_events"("tenant_id", "event_id");

-- AddForeignKey
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$');

-- A booking can have at most one open payment attempt at a time.
CREATE UNIQUE INDEX "payments_one_open_per_booking" ON "payments"("booking_id") WHERE "status" IN ('CREATED', 'PENDING');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_settings','payments','payment_webhook_events'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_settings", "payments", "payment_webhook_events" TO nts_app;
    REVOKE DELETE ON "payments", "payment_webhook_events" FROM nts_app;
  END IF;
END $$;
