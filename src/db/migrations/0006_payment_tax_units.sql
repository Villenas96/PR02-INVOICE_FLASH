CREATE TYPE "public"."collection_method_kind" AS ENUM('bank_account', 'bizum', 'paypal', 'cash', 'other');--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'quote_accepted';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'quote_rejected';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'linked';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'link_released';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'reminder_sent';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'reminder_skipped';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'recurring_generated';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'exported';--> statement-breakpoint
ALTER TYPE "public"."document_event_type" ADD VALUE IF NOT EXISTS 'series_changed';--> statement-breakpoint
CREATE TABLE "collection_method" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "collection_method_kind" NOT NULL,
	"label" text NOT NULL,
	"holder_name" text,
	"iban" text,
	"bic" text,
	"phone" text,
	"email_or_url" text,
	"instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_unit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rate_rate_valid" CHECK ("tax_rate"."rate" >= 0 AND "tax_rate"."rate" < 100),
	CONSTRAINT "tax_rate_name_length" CHECK (char_length("tax_rate"."name") BETWEEN 1 AND 30)
);
--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "document_series" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "tax_name" text DEFAULT 'IVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "catalog_item_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "collection_method_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "collection_method_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "collection_method" ADD CONSTRAINT "collection_method_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_unit" ADD CONSTRAINT "measurement_unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_method_company_archived_idx" ON "collection_method" USING btree ("company_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_method_company_default_unique" ON "collection_method" USING btree ("company_id") WHERE "collection_method"."is_default" AND "collection_method"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_unit_company_name_unique" ON "measurement_unit" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_company_name_rate_unique" ON "tax_rate" USING btree ("company_id","name","rate") WHERE "tax_rate"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_company_default_unique" ON "tax_rate" USING btree ("company_id") WHERE "tax_rate"."is_default" AND "tax_rate"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_tax_rate_id_tax_rate_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_catalog_item_id_catalog_item_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_collection_method_id_collection_method_id_fk" FOREIGN KEY ("collection_method_id") REFERENCES "public"."collection_method"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Seed IVA 21/10/4/0 for every company, keeping its current default rate
-- as the default tax type, before the old column goes away.
INSERT INTO "tax_rate" ("id", "company_id", "name", "rate", "is_default", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  "company"."id",
  'IVA',
  seeded.rate,
  seeded.rate = "company"."default_tax_rate",
  now(),
  now()
FROM "company"
CROSS JOIN (VALUES (21.00::numeric(5, 2)), (10.00), (4.00), (0.00)) AS seeded(rate);--> statement-breakpoint
ALTER TABLE "company" DROP COLUMN "default_tax_rate";