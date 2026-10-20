ALTER TABLE "billing_price" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'basic'::text;--> statement-breakpoint
ALTER TABLE "plan_change" ALTER COLUMN "from_plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_change" ALTER COLUMN "to_plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
-- `free` was folded into `basic` by 0005; this guarantees none is left.
UPDATE "company" SET "plan" = 'basic' WHERE "plan" = 'free';--> statement-breakpoint
UPDATE "plan_change" SET "from_plan" = 'basic' WHERE "from_plan" = 'free';--> statement-breakpoint
UPDATE "plan_change" SET "to_plan" = 'basic' WHERE "to_plan" = 'free';--> statement-breakpoint
UPDATE "subscription" SET "plan" = 'basic' WHERE "plan" = 'free';--> statement-breakpoint
UPDATE "billing_price" SET "plan" = 'basic' WHERE "plan" = 'free';--> statement-breakpoint
DROP TYPE "public"."plan";--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('basic', 'essential', 'pro');--> statement-breakpoint
ALTER TABLE "billing_price" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'basic'::"public"."plan";--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";--> statement-breakpoint
ALTER TABLE "plan_change" ALTER COLUMN "from_plan" SET DATA TYPE "public"."plan" USING "from_plan"::"public"."plan";--> statement-breakpoint
ALTER TABLE "plan_change" ALTER COLUMN "to_plan" SET DATA TYPE "public"."plan" USING "to_plan"::"public"."plan";--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DATA TYPE "public"."plan" USING "plan"::"public"."plan";