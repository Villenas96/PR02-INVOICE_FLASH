BEGIN;

DROP INDEX IF EXISTS "document_company_deleted_at_idx";
ALTER TABLE "document" DROP COLUMN IF EXISTS "deleted_at";

COMMIT;
