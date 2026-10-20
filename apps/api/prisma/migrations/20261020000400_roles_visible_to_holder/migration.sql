-- A user must be able to read the role attached to their OWN membership even without a tenant
-- context (e.g. when listing "my companies"). Everything else about roles stays tenant-scoped.
-- Split the single ALL policy so only SELECT gains the extra branch; writes remain tenant/platform only.
DROP POLICY IF EXISTS roles_isolation ON "roles";

CREATE POLICY roles_select ON "roles" FOR SELECT
  USING ("tenant_id" = app_tenant_id() OR app_is_platform()
         OR EXISTS (SELECT 1 FROM "memberships" m
                    WHERE m."role_id" = "roles"."id" AND m."user_id" = app_user_id()));
CREATE POLICY roles_insert ON "roles" FOR INSERT
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY roles_update ON "roles" FOR UPDATE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY roles_delete ON "roles" FOR DELETE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform());
