BEGIN;

DROP INDEX IF EXISTS "document_client_logo_key_idx";
DROP INDEX IF EXISTS "document_issuer_logo_key_idx";
ALTER TABLE "client" DROP COLUMN IF EXISTS "logo_key";

COMMIT;
