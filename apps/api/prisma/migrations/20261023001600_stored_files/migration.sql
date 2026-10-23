-- Phase 13: index of uploaded documents (the bytes live in object storage).
-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('APPLICATION_CV', 'COMPLAINT_ATTACHMENT');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "owner_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_object_key_key" ON "stored_files"("object_key");

-- CreateIndex
CREATE INDEX "stored_files_tenant_id_kind_owner_id_idx" ON "stored_files"("tenant_id", "kind", "owner_id");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_chk" CHECK ("size_bytes" BETWEEN 1 AND 5242880);
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_type_chk" CHECK ("content_type" IN ('application/pdf', 'image/png', 'image/jpeg'));
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_hash_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- An application has at most one live CV; replacing it retires the old row (deleted_at).
CREATE UNIQUE INDEX "stored_files_one_live_cv" ON "stored_files"("owner_id") WHERE "kind" = 'APPLICATION_CV' AND "deleted_at" IS NULL;

ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY "stored_files_isolation" ON "stored_files"
  USING ("tenant_id" = app_tenant_id() OR app_is_platform())
  WITH CHECK ("tenant_id" = app_tenant_id() OR app_is_platform());

-- Rows are never removed; only deleted_at is set.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nts_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "stored_files" TO nts_app;
    REVOKE DELETE ON "stored_files" FROM nts_app;
  END IF;
END $$;
