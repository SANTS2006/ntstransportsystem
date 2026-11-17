-- Applicants can also upload a photo of their licence, their own picture, and files asked for by a
-- custom application form. Kept apart from the next migration because a new enum value cannot be
-- used in the transaction that adds it.
ALTER TYPE "FileKind" ADD VALUE IF NOT EXISTS 'APPLICATION_LICENCE';
ALTER TYPE "FileKind" ADD VALUE IF NOT EXISTS 'APPLICATION_PHOTO';
ALTER TYPE "FileKind" ADD VALUE IF NOT EXISTS 'APPLICATION_FORM_FILE';
