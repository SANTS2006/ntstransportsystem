-- Phase 20: company branding (logo and colours), profile pictures, forced first password change.

CREATE TABLE "tenant_branding" (
    "tenant_id" UUID NOT NULL,
    "primary_color" TEXT,
    "accent_color" TEXT,
    "logo_data" BYTEA,
    "logo_type" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_primary_chk" CHECK ("primary_color" IS NULL OR "primary_color" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_accent_chk" CHECK ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_logo_chk" CHECK (
  ("logo_data" IS NULL AND "logo_type" IS NULL)
  OR ("logo_data" IS NOT NULL AND "logo_type" IN ('image/png', 'image/jpeg', 'image/webp') AND octet_length("logo_data") <= 600000)
);

ALTER TABLE "tenant_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_branding_isolation" ON "tenant_branding"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

CREATE TABLE "user_avatars" (
    "user_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_chk" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp') AND octet_length("data") <= 400000);

-- A password made for someone else (a company's first administrator) must be replaced at first sign-in.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    REVOKE ALL ON "tenant_branding", "user_avatars" FROM nts_app;
    GRANT SELECT, INSERT, UPDATE ON "tenant_branding" TO nts_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "user_avatars" TO nts_app;
  END IF;
END $$;
