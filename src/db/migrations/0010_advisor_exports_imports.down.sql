BEGIN;

ALTER TABLE "email_delivery" DROP COLUMN IF EXISTS "export_job_id";
ALTER TABLE "company" DROP COLUMN IF EXISTS "advisor_email";
ALTER TABLE "catalog_item" DROP COLUMN IF EXISTS "source_import_id";
ALTER TABLE "session" DROP COLUMN IF EXISTS "active_company_id";
DROP TABLE IF EXISTS "import_job";
DROP TABLE IF EXISTS "export_job";
DROP TABLE IF EXISTS "company_access";
DROP TABLE IF EXISTS "advisor_schedule";
DROP TABLE IF EXISTS "access_event";
DROP TYPE IF EXISTS "import_status";
DROP TYPE IF EXISTS "import_kind";
DROP TYPE IF EXISTS "import_duplicate_policy";
DROP TYPE IF EXISTS "export_status";
DROP TYPE IF EXISTS "export_kind";
DROP TYPE IF EXISTS "company_access_status";
DROP TYPE IF EXISTS "company_access_role";
DROP TYPE IF EXISTS "advisor_schedule_frequency";
DROP TYPE IF EXISTS "access_event_action";
-- Postgres cannot drop enum values: the new `email_purpose` values stay,
-- unused by earlier versions.

COMMIT;
