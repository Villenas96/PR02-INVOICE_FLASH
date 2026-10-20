CREATE TYPE "public"."bank_statement_format" AS ENUM('norma43', 'csv', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."reminder_outcome" AS ENUM('queued', 'sent', 'skipped_paid', 'skipped_no_email', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sample_render_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."email_purpose" ADD VALUE IF NOT EXISTS 'payment_reminder';--> statement-breakpoint
CREATE TABLE "bank_statement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"collection_method_id" uuid NOT NULL,
	"format" "bank_statement_format" NOT NULL,
	"file_key" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"closing_balance_cents" bigint,
	"closing_balance_on" date,
	"import_job_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"collection_method_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"operation_on" date NOT NULL,
	"value_on" date,
	"amount_cents" bigint NOT NULL,
	"concept" text DEFAULT '' NOT NULL,
	"reference" text,
	"fingerprint" text NOT NULL,
	"occurrence" integer DEFAULT 1 NOT NULL,
	"ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_reminder" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"scheduled_on" date NOT NULL,
	"sequence" integer NOT NULL,
	"outcome" "reminder_outcome" DEFAULT 'queued' NOT NULL,
	"email_delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_amount_positive" CHECK ("reconciliation"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sample_render" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "sample_render_status" DEFAULT 'pending' NOT NULL,
	"file_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "reminder_policy" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_collection_method_id_collection_method_id_fk" FOREIGN KEY ("collection_method_id") REFERENCES "public"."collection_method"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_collection_method_id_collection_method_id_fk" FOREIGN KEY ("collection_method_id") REFERENCES "public"."collection_method"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_statement_id_bank_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminder" ADD CONSTRAINT "payment_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminder" ADD CONSTRAINT "payment_reminder_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminder" ADD CONSTRAINT "payment_reminder_email_delivery_id_email_delivery_id_fk" FOREIGN KEY ("email_delivery_id") REFERENCES "public"."email_delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_bank_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_render" ADD CONSTRAINT "sample_render_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_company_imported_idx" ON "bank_statement" USING btree ("company_id","imported_at");--> statement-breakpoint
CREATE INDEX "bank_statement_method_closing_idx" ON "bank_statement" USING btree ("collection_method_id","closing_balance_on");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transaction_fingerprint_unique" ON "bank_transaction" USING btree ("collection_method_id","fingerprint","occurrence");--> statement-breakpoint
CREATE INDEX "bank_transaction_company_operation_idx" ON "bank_transaction" USING btree ("company_id","operation_on");--> statement-breakpoint
CREATE INDEX "bank_transaction_statement_idx" ON "bank_transaction" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "bank_transaction_income_idx" ON "bank_transaction" USING btree ("company_id","operation_on") WHERE "bank_transaction"."amount_cents" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reminder_document_day_unique" ON "payment_reminder" USING btree ("document_id","scheduled_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reminder_document_sequence_unique" ON "payment_reminder" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE INDEX "payment_reminder_company_created_idx" ON "payment_reminder" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_payment_unique" ON "reconciliation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "reconciliation_document_idx" ON "reconciliation" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reconciliation_transaction_idx" ON "reconciliation" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "sample_render_company_created_idx" ON "sample_render" USING btree ("company_id","created_at");