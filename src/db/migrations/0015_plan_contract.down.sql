BEGIN;

ALTER TABLE "billing_price" ALTER COLUMN "plan" SET DATA TYPE text;
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE text;
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'basic'::text;
ALTER TABLE "plan_change" ALTER COLUMN "from_plan" SET DATA TYPE text;
ALTER TABLE "plan_change" ALTER COLUMN "to_plan" SET DATA TYPE text;
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DATA TYPE text;
DROP TYPE "public"."plan";
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'basic', 'essential');
ALTER TABLE "billing_price" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'basic'::"public"."plan";
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";
ALTER TABLE "plan_change" ALTER COLUMN "from_plan" SET DATA TYPE "public"."plan" USING "from_plan"::"public"."plan";
ALTER TABLE "plan_change" ALTER COLUMN "to_plan" SET DATA TYPE "public"."plan" USING "to_plan"::"public"."plan";
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";

COMMIT;
