-- Phase 16: money handed back for a booking that was paid at the desk and then cancelled.
ALTER TABLE "payments" ADD COLUMN "refunded_at" TIMESTAMPTZ(6);
ALTER TABLE "payments" ADD COLUMN "refunded_by" UUID;
ALTER TABLE "payments" ADD COLUMN "refund_reference" TEXT;

-- Only a desk payment that was PAID can carry a refund, and it records when and by whom.
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_chk" CHECK (
  ("refunded_at" IS NULL AND "refunded_by" IS NULL AND "refund_reference" IS NULL)
  OR ("provider" = 'DESK' AND "status" = 'PAID' AND "refunded_at" IS NOT NULL AND "refunded_by" IS NOT NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_ref_len_chk" CHECK ("refund_reference" IS NULL OR char_length("refund_reference") <= 80);
