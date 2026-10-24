-- Phase 22: every ordinary account belongs to the company whose page it signed up on, and can only
-- sign in from that company's own page. Platform administrators and company staff have no home
-- company of their own (staff belong through their membership).
ALTER TABLE "users" ADD COLUMN "home_tenant_id" UUID;
ALTER TABLE "users" ADD CONSTRAINT "users_home_tenant_id_fkey" FOREIGN KEY ("home_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_home_tenant_id_idx" ON "users"("home_tenant_id");
