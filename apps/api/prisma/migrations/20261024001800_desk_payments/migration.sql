-- Phase 15: payments taken at the desk (cash, mobile money shown at the counter, bank transfer).
ALTER TABLE "payments" ADD COLUMN "method" TEXT;
ALTER TABLE "payments" ADD COLUMN "collected_by" UUID;
ALTER TABLE "payments" ADD COLUMN "reference" TEXT;

-- A desk payment always says how it was taken and who took it; an online payment never does.
ALTER TABLE "payments" ADD CONSTRAINT "payments_desk_chk" CHECK (
  ("provider" = 'DESK' AND "method" IN ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER') AND "collected_by" IS NOT NULL)
  OR ("provider" <> 'DESK' AND "method" IS NULL AND "collected_by" IS NULL AND "reference" IS NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reference_len_chk" CHECK ("reference" IS NULL OR char_length("reference") <= 80);

-- A booking is paid at the desk at most once.
CREATE UNIQUE INDEX "payments_one_desk_payment" ON "payments"("tenant_id", "booking_id") WHERE "provider" = 'DESK';

-- 'payment.collect' is new: owners, administrators and sales agents may take payments at the desk.
-- Roles keep their permissions as rows, so grant it where it is missing (idempotent).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'payment.collect' FROM "roles" r WHERE r."key" IN ('owner', 'admin', 'sales_agent')
ON CONFLICT DO NOTHING;
