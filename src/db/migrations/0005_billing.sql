CREATE TYPE "public"."ui_mode" AS ENUM('simple', 'full');--> statement-breakpoint
CREATE TYPE "public"."plan_change_reason" AS ENUM('checkout', 'portal', 'renewal_failed', 'grace_expired', 'canceled', 'migration', 'admin');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
ALTER TYPE "public"."email_purpose" ADD VALUE IF NOT EXISTS 'billing_notice';--> statement-breakpoint
CREATE TABLE "billing_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "billing_price" (
	"lookup_key" text PRIMARY KEY NOT NULL,
	"stripe_price_id" text NOT NULL,
	"plan" "plan" NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"from_plan" "plan" NOT NULL,
	"to_plan" "plan" NOT NULL,
	"reason" "plan_change_reason" NOT NULL,
	"billing_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" "plan" NOT NULL,
	"interval" "billing_interval",
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_until" timestamp with time zone,
	"grace_notice_sent_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "plan" SET DEFAULT 'basic';--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "ui_mode" "ui_mode";--> statement-breakpoint
ALTER TABLE "email_delivery" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_billing_event_id_billing_event_id_fk" FOREIGN KEY ("billing_event_id") REFERENCES "public"."billing_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_event_stripe_event_unique" ON "billing_event" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_price_stripe_price_unique" ON "billing_price" USING btree ("stripe_price_id");--> statement-breakpoint
CREATE INDEX "plan_change_company_created_at_idx" ON "plan_change" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_company_unique" ON "subscription" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_customer_unique" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_subscription_unique" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
-- Data step (data-model, «Migración del plan»): record one `migration` plan
-- change per company with its v1 plan, then map free→basic and pro→essential.
-- From here on `pro` has no rows and means the v2 Pro plan.
INSERT INTO "plan_change" ("id", "company_id", "from_plan", "to_plan", "reason", "created_at")
SELECT
  gen_random_uuid(),
  "id",
  "plan",
  CASE "plan"
    WHEN 'free'::"plan" THEN 'basic'::"plan"
    WHEN 'pro'::"plan" THEN 'essential'::"plan"
    ELSE "plan"
  END,
  'migration'::"plan_change_reason",
  now()
FROM "company";--> statement-breakpoint
UPDATE "company" SET "plan" = 'basic' WHERE "plan" = 'free';--> statement-breakpoint
UPDATE "company" SET "plan" = 'essential' WHERE "plan" = 'pro';
