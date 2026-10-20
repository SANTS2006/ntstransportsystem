-- Hand-written migration: defense-in-depth for tenant isolation and audit integrity.
-- Rollback limitation: policies/functions can be dropped, but dropping them re-opens
-- database-level isolation; the application layer remains the primary control.
--
-- The application MUST connect as a role WITHOUT SUPERUSER/BYPASSRLS (see docs/TENANCY.md),
-- and must set context only via transaction-local set_config(..., true).

-- Data-shape guards -----------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_currency_chk" CHECK ("default_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_chk" CHECK ("expires_at" > "created_at");

-- Context helpers (transaction-local settings; empty/unset => NULL) -------------
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;

-- Row-level security -----------------------------------------------------------
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON "roles"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
-- The subquery is itself filtered by the roles policy.
CREATE POLICY role_permissions_isolation ON "role_permissions"
  USING (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_id"));

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
-- A user may read their own memberships across tenants (to resolve tenant context at login).
CREATE POLICY memberships_select ON "memberships" FOR SELECT
  USING ("tenant_id" = app_tenant_id() OR "user_id" = app_user_id() OR app_is_platform());
CREATE POLICY memberships_insert ON "memberships" FOR INSERT
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY memberships_update ON "memberships" FOR UPDATE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY memberships_delete ON "memberships" FOR DELETE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON "audit_logs" FOR SELECT
  USING ("tenant_id" = app_tenant_id() OR app_is_platform());
-- Pre-auth/platform-scope events (tenant_id NULL) may always be appended.
CREATE POLICY audit_logs_insert ON "audit_logs" FOR INSERT
  WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = app_tenant_id() OR app_is_platform());

-- Append-only audit log ---------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- Grants for the restricted application role, if it exists (created out-of-band) ---
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT USAGE ON SCHEMA public TO nts_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nts_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM nts_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nts_app;
  END IF;
END $$;
