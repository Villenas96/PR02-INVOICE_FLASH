BEGIN;

DROP INDEX IF EXISTS "client_search_text_trgm_idx";
DROP INDEX IF EXISTS "catalog_item_search_text_trgm_idx";
ALTER TABLE "client" DROP COLUMN IF EXISTS "search_text";
ALTER TABLE "client" DROP COLUMN IF EXISTS "city";
ALTER TABLE "client" DROP COLUMN IF EXISTS "postal_code";
ALTER TABLE "catalog_item" DROP COLUMN IF EXISTS "search_text";
DROP FUNCTION IF EXISTS immutable_unaccent(text);
-- Extensions are left installed: other database objects may rely on them.

COMMIT;
