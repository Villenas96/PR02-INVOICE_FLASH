-- Expand step of the plan migration (specs/002 data-model, «Migración del plan»).
-- Recreate `plan` as the superset instead of `ALTER TYPE ... ADD VALUE`:
-- drizzle applies every pending migration in one transaction and Postgres
-- rejects using a value added with ADD VALUE inside that same transaction
-- (0005_billing writes 'basic'/'essential'). A type created in the
-- transaction can be used freely.
ALTER TABLE "company" ALTER COLUMN "plan" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."plan" RENAME TO "plan_old";--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'basic', 'essential');--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::text::"public"."plan";--> statement-breakpoint
DROP TYPE "public"."plan_old";--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'free';
