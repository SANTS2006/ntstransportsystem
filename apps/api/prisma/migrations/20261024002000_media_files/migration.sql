-- Phase 17: images, photos, audio (voice messages) and video can be stored, with per-class size limits.
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_size_chk";
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_type_chk";

ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_type_chk" CHECK ("content_type" IN (
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'
));
-- Documents and images up to 5 MB, audio up to 10 MB, video up to 25 MB.
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_chk" CHECK (
  "size_bytes" >= 1 AND (
    ("content_type" LIKE 'video/%' AND "size_bytes" <= 26214400)
    OR ("content_type" LIKE 'audio/%' AND "size_bytes" <= 10485760)
    OR ("content_type" NOT LIKE 'video/%' AND "content_type" NOT LIKE 'audio/%' AND "size_bytes" <= 5242880)
  )
);
