BEGIN;

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "converted_from_id" uuid;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "converted_to_id" uuid;

-- v1 only knew proforma → invoice, one per proforma: keep the earliest link.
UPDATE "document" target
SET "converted_from_id" = link."source_document_id"
FROM "document_link" link
WHERE link."target_document_id" = target."id" AND link."kind" = 'converted';

UPDATE "document" source
SET "converted_to_id" = first_link."target_document_id"
FROM (
  SELECT DISTINCT ON ("source_document_id") "source_document_id", "target_document_id"
  FROM "document_link"
  WHERE "kind" = 'converted'
  ORDER BY "source_document_id", "created_at"
) first_link
WHERE first_link."source_document_id" = source."id";

ALTER TABLE "document" ADD CONSTRAINT "document_converted_from_id_document_id_fk" FOREIGN KEY ("converted_from_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "document" ADD CONSTRAINT "document_converted_to_id_document_id_fk" FOREIGN KEY ("converted_to_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;

DROP INDEX IF EXISTS "document_company_client_type_status_idx";
DROP INDEX IF EXISTS "document_company_type_quote_decision_idx";
DROP TABLE IF EXISTS "document_link";
ALTER TABLE "document" DROP COLUMN IF EXISTS "quote_decided_at";
ALTER TABLE "document" DROP COLUMN IF EXISTS "quote_decision";
ALTER TABLE "document" DROP COLUMN IF EXISTS "valid_until";
ALTER TABLE "document_line" DROP COLUMN IF EXISTS "section_label";
DROP TYPE IF EXISTS "quote_decision";
DROP TYPE IF EXISTS "document_link_kind";
-- Postgres cannot drop enum values: `quote` and `delivery_note` stay in
-- `document_type`, unused by v1.

COMMIT;
