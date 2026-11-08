CREATE TYPE "public"."recurring_outcome" AS ENUM('pending', 'draft_created', 'issued', 'sent', 'skipped_plan', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recurring_action" AS ENUM('draft', 'issue', 'issue_and_send');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_interval_unit" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'finished');--> statement-breakpoint
CREATE TABLE "recurring_cycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"cycle_index" integer NOT NULL,
	"scheduled_on" date NOT NULL,
	"template_version" integer NOT NULL,
	"outcome" "recurring_outcome" DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"series_id" uuid,
	"collection_method_id" uuid,
	"lines" jsonb NOT NULL,
	"notes" text,
	"due_days" integer DEFAULT 30 NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"interval_unit" "recurring_interval_unit",
	"start_on" date NOT NULL,
	"end_on" date,
	"max_cycles" integer,
	"action" "recurring_action" DEFAULT 'draft' NOT NULL,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"next_run_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_template_single_end" CHECK ("recurring_template"."end_on" IS NULL OR "recurring_template"."max_cycles" IS NULL),
	CONSTRAINT "recurring_template_interval_positive" CHECK ("recurring_template"."interval_count" >= 1),
	CONSTRAINT "recurring_template_max_cycles_positive" CHECK ("recurring_template"."max_cycles" IS NULL OR "recurring_template"."max_cycles" >= 1),
	CONSTRAINT "recurring_template_due_days_valid" CHECK ("recurring_template"."due_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "recurring_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_cycle" ADD CONSTRAINT "recurring_cycle_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cycle" ADD CONSTRAINT "recurring_cycle_template_id_recurring_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_collection_method_id_collection_method_id_fk" FOREIGN KEY ("collection_method_id") REFERENCES "public"."collection_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_cycle_template_index_unique" ON "recurring_cycle" USING btree ("template_id","cycle_index");--> statement-breakpoint
CREATE INDEX "recurring_template_next_run_on_active_idx" ON "recurring_template" USING btree ("next_run_on") WHERE "recurring_template"."status" = 'active';--> statement-breakpoint
CREATE INDEX "recurring_template_company_status_idx" ON "recurring_template" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_notification_idempotency_key_unique" ON "user_notification" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "user_notification_user_read_created_idx" ON "user_notification" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_recurring_cycle_id_recurring_cycle_id_fk" FOREIGN KEY ("recurring_cycle_id") REFERENCES "public"."recurring_cycle"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_recurring_cycle_unique" ON "document" USING btree ("recurring_cycle_id");