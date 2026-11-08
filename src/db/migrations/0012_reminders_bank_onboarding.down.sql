BEGIN;

DROP TABLE IF EXISTS "reconciliation";
DROP TABLE IF EXISTS "bank_transaction";
DROP TABLE IF EXISTS "bank_statement";
DROP TABLE IF EXISTS "payment_reminder";
DROP TABLE IF EXISTS "sample_render";
ALTER TABLE "document" DROP COLUMN IF EXISTS "reminders_enabled";
ALTER TABLE "company" DROP COLUMN IF EXISTS "onboarding";
ALTER TABLE "company" DROP COLUMN IF EXISTS "reminder_policy";
ALTER TABLE "client" DROP COLUMN IF EXISTS "reminders_enabled";
DROP TYPE IF EXISTS "sample_render_status";
DROP TYPE IF EXISTS "reminder_outcome";
DROP TYPE IF EXISTS "bank_statement_format";
-- Postgres cannot drop enum values: `payment_reminder` stays in
-- `email_purpose`, unused by earlier versions.

COMMIT;
