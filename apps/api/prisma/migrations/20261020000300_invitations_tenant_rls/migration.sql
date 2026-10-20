-- Invitations (tenant-scoped, RLS) and row-level security for the tenants table itself.

CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_email_lowercase_chk" CHECK ("email" = lower(btrim("email")))
);
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_tenant_id_email_idx" ON "invitations"("tenant_id", "email");
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite FK: the invited role must belong to the same tenant.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_role_id_fkey"
  FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_isolation ON "invitations"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

-- Tenants: a user sees only companies they belong to (membership rows are themselves RLS-filtered);
-- only platform scope may create companies; no DELETE policy exists, so deletes are denied.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON "tenants" FOR SELECT
  USING ("id" = app_tenant_id() OR app_is_platform()
         OR EXISTS (SELECT 1 FROM "memberships" m WHERE m."tenant_id" = "tenants"."id"));
CREATE POLICY tenants_insert ON "tenants" FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY tenants_update ON "tenants" FOR UPDATE
  USING ("id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("id" = app_tenant_id() OR app_is_platform());

-- A company must not approve, suspend or reactivate itself: lifecycle status is platform-only.
CREATE OR REPLACE FUNCTION tenants_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT app_is_platform() THEN
    RAISE EXCEPTION 'tenant status can only be changed by platform administrators';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_status_guard BEFORE UPDATE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION tenants_status_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO nts_app;
  END IF;
END $$;
