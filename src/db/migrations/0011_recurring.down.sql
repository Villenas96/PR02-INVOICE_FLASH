BEGIN;

DROP INDEX IF EXISTS "document_recurring_cycle_unique";
ALTER TABLE "document" DROP COLUMN IF EXISTS "recurring_cycle_id";
DROP TABLE IF EXISTS "user_notification";
DROP TABLE IF EXISTS "recurring_cycle";
DROP TABLE IF EXISTS "recurring_template";
DROP TYPE IF EXISTS "recurring_status";
DROP TYPE IF EXISTS "recurring_interval_unit";
DROP TYPE IF EXISTS "recurring_frequency";
DROP TYPE IF EXISTS "recurring_action";
DROP TYPE IF EXISTS "recurring_outcome";

COMMIT;
