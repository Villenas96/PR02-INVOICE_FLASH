BEGIN;

-- Map the v2 values back to their v1 equivalents before shrinking the type.
ALTER TABLE "company" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TYPE "public"."plan" RENAME TO "plan_new";
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING (
  CASE "plan"::text
    WHEN 'basic' THEN 'free'
    WHEN 'essential' THEN 'pro'
    ELSE "plan"::text
  END
)::"public"."plan";
DROP TYPE "public"."plan_new";
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'free';

COMMIT;
