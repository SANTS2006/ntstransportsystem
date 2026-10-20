-- MFA (TOTP + recovery codes) and Google-sign-in support.
ALTER TYPE "OneTimeTokenPurpose" ADD VALUE IF NOT EXISTS 'MFA_CHALLENGE';

ALTER TABLE "one_time_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "mfa_credentials" (
    "user_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key" ON "recovery_codes"("user_id", "code_hash");

ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grants: explicit for the new tables, plus default privileges so future tables created by the
-- migrating (owner) role are usable by the restricted app role without a manual step.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_credentials", "recovery_codes" TO nts_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nts_app;
  END IF;
END $$;
