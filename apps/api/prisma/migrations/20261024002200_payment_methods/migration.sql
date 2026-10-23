-- Phase 19: payment methods (Orange Money, AfriMoney, QMoney).

-- Online payments may record which wallet the customer chose; desk payments may name the wallet.
ALTER TABLE "payments" DROP CONSTRAINT "payments_desk_chk";
ALTER TABLE "payments" ADD CONSTRAINT "payments_desk_chk" CHECK (
  ("provider" = 'DESK'
    AND "method" IN ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'ORANGE_MONEY', 'AFRIMONEY', 'QMONEY')
    AND "collected_by" IS NOT NULL)
  OR ("provider" <> 'DESK'
    AND "collected_by" IS NULL AND "reference" IS NULL
    AND ("method" IS NULL OR "method" IN ('ORANGE_MONEY', 'AFRIMONEY', 'QMONEY')))
);

-- CreateTable
CREATE TABLE "manual_payment_settings" (
    "tenant_id" UUID NOT NULL,
    "qmoney_number" TEXT,
    "qmoney_account_name" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_payment_settings_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "manual_payment_settings" ADD CONSTRAINT "manual_payment_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_payment_settings" ADD CONSTRAINT "manual_payment_settings_number_chk" CHECK ("qmoney_number" IS NULL OR "qmoney_number" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "manual_payment_settings" ADD CONSTRAINT "manual_payment_settings_name_chk" CHECK ("qmoney_account_name" IS NULL OR char_length("qmoney_account_name") BETWEEN 1 AND 80);

-- CreateTable
CREATE TABLE "payment_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_claims_tenant_id_booking_id_status_idx" ON "payment_claims"("tenant_id", "booking_id", "status");
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_booking_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_method_chk" CHECK ("method" = 'QMONEY');
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_status_chk" CHECK ("status" IN ('PENDING', 'CONFIRMED'));
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_reference_chk" CHECK (char_length("reference") BETWEEN 4 AND 40);
-- One transaction id can be claimed once per company: it cannot pay for two bookings.
CREATE UNIQUE INDEX "payment_claims_one_per_reference" ON "payment_claims"("tenant_id", "method", lower("reference"));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['manual_payment_settings', 'payment_claims'] LOOP
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
    REVOKE ALL ON "manual_payment_settings", "payment_claims" FROM nts_app;
    GRANT SELECT, INSERT, UPDATE ON "manual_payment_settings", "payment_claims" TO nts_app;
  END IF;
END $$;
