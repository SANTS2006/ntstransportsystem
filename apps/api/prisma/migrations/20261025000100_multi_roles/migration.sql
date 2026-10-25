-- Phase 23: a staff member can hold several roles in a company and switch between them (and the
-- default "passenger" role). memberships.role_id stays the role they are acting as right now;
-- membership_roles lists every role they hold; passenger_mode means they are acting as a passenger.

ALTER TABLE "memberships" ADD COLUMN "passenger_mode" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "membership_roles" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id", "role_id")
);
CREATE INDEX "membership_roles_tenant_id_idx" ON "membership_roles"("tenant_id");
CREATE INDEX "membership_roles_role_id_idx" ON "membership_roles"("role_id");
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The role must belong to the same company as the membership.
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone already holds the role they have.
INSERT INTO "membership_roles" ("membership_id", "role_id", "tenant_id")
SELECT "id", "role_id", "tenant_id" FROM "memberships";

-- Whatever role a membership is set to act as is always one it holds.
CREATE OR REPLACE FUNCTION membership_holds_active_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "membership_roles" ("membership_id", "role_id", "tenant_id")
  VALUES (NEW."id", NEW."role_id", NEW."tenant_id")
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_hold_active_role
  AFTER INSERT OR UPDATE OF "role_id" ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION membership_holds_active_role();

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;
-- A person may read the roles they hold in any company (to list and switch them).
CREATE POLICY "membership_roles_select" ON "membership_roles" FOR SELECT
  USING ("tenant_id" = app_tenant_id() OR app_is_platform()
         OR EXISTS (SELECT 1 FROM "memberships" m
                    WHERE m."id" = "membership_roles"."membership_id" AND m."user_id" = app_user_id()));
CREATE POLICY "membership_roles_insert" ON "membership_roles" FOR INSERT
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY "membership_roles_update" ON "membership_roles" FOR UPDATE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());
CREATE POLICY "membership_roles_delete" ON "membership_roles" FOR DELETE
  USING ("tenant_id" = app_tenant_id() OR app_is_platform());

-- A role the person holds must be readable by them even when it is not the one they act as.
DROP POLICY IF EXISTS "roles_select" ON "roles";
CREATE POLICY "roles_select" ON "roles" FOR SELECT
  USING ("tenant_id" = app_tenant_id() OR app_is_platform()
         OR EXISTS (SELECT 1 FROM "memberships" m
                    WHERE m."role_id" = "roles"."id" AND m."user_id" = app_user_id())
         OR EXISTS (SELECT 1 FROM "membership_roles" mr
                    JOIN "memberships" m ON m."id" = mr."membership_id"
                    WHERE mr."role_id" = "roles"."id" AND m."user_id" = app_user_id()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    REVOKE ALL ON "membership_roles" FROM nts_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "membership_roles" TO nts_app;
  END IF;
END $$;
