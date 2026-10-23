-- Phase 18: accounts can be created and verified with a phone number.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- An account is reachable by e-mail, by phone, or both; never neither. Phones are stored as E.164.
ALTER TABLE "users" ADD CONSTRAINT "users_contact_chk" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "users_phone_format_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified_chk" CHECK ("phone_verified_at" IS NULL OR "phone" IS NOT NULL);

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "phone_otps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "user_id" UUID,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_otps_phone_purpose_created_at_idx" ON "phone_otps"("phone", "purpose", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "phone_otps" ADD CONSTRAINT "phone_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phone_otps" ADD CONSTRAINT "phone_otps_attempts_chk" CHECK ("attempts" >= 0);
ALTER TABLE "phone_otps" ADD CONSTRAINT "phone_otps_phone_chk" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Like one_time_tokens, this is application-level (not tenant-scoped); the app role may insert,
-- read, and update attempts/consumption, but never delete rows by hand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    REVOKE ALL ON "phone_otps" FROM nts_app;
    GRANT SELECT, INSERT, UPDATE ON "phone_otps" TO nts_app;
  END IF;
END $$;
