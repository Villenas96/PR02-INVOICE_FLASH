BEGIN;

ALTER TABLE "company" ADD COLUMN "default_tax_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL;
UPDATE "company" SET "default_tax_rate" = default_rate.rate
FROM (
  SELECT DISTINCT ON ("company_id") "company_id", "rate"
  FROM "tax_rate"
  WHERE "is_default" AND "archived_at" IS NULL
  ORDER BY "company_id", "created_at"
) AS default_rate
WHERE default_rate."company_id" = "company"."id";

ALTER TABLE "document" DROP CONSTRAINT IF EXISTS "document_collection_method_id_collection_method_id_fk";
ALTER TABLE "document" DROP COLUMN IF EXISTS "collection_method_snapshot";
ALTER TABLE "document" DROP COLUMN IF EXISTS "collection_method_id";
ALTER TABLE "document_line" DROP COLUMN IF EXISTS "catalog_item_id";
ALTER TABLE "document_line" DROP COLUMN IF EXISTS "tax_name";
ALTER TABLE "document_line" DROP COLUMN IF EXISTS "tax_rate_id";
ALTER TABLE "document_line" DROP COLUMN IF EXISTS "unit";
ALTER TABLE "document_series" DROP COLUMN IF EXISTS "archived_at";
ALTER TABLE "catalog_item" DROP COLUMN IF EXISTS "tax_rate_id";
ALTER TABLE "catalog_item" DROP COLUMN IF EXISTS "unit";

DROP TABLE IF EXISTS "tax_rate";
DROP TABLE IF EXISTS "measurement_unit";
DROP TABLE IF EXISTS "collection_method";
DROP TYPE IF EXISTS "public"."collection_method_kind";

-- New document_event_type values cannot be dropped; they stay unused and
-- the up migration re-adds them with IF NOT EXISTS.

COMMIT;
