BEGIN;

-- Reverse the data mapping: v2 values back to the v1 plans. A v2 Pro company
-- keeps the v1 paid plan (`pro`), the closest equivalent.
UPDATE "company" SET "plan" = 'free' WHERE "plan" = 'basic';
UPDATE "company" SET "plan" = 'pro' WHERE "plan" = 'essential';

ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'free';
ALTER TABLE "company" DROP COLUMN IF EXISTS "ui_mode";
ALTER TABLE "email_delivery" DROP COLUMN IF EXISTS "template";
ALTER TABLE "email_delivery" DROP COLUMN IF EXISTS "payload";

DROP TABLE IF EXISTS "subscription";
DROP TABLE IF EXISTS "plan_change";
DROP TABLE IF EXISTS "billing_price";
DROP TABLE IF EXISTS "billing_event";

DROP TYPE IF EXISTS "public"."subscription_status";
DROP TYPE IF EXISTS "public"."billing_interval";
DROP TYPE IF EXISTS "public"."plan_change_reason";
DROP TYPE IF EXISTS "public"."ui_mode";

-- Postgres cannot drop a single enum value: `email_purpose.billing_notice`
-- stays defined but unused; the up migration adds it with IF NOT EXISTS.

COMMIT;
