CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."document_event_type" AS ENUM('created', 'updated', 'issued', 'voided', 'converted', 'duplicated', 'pdf_generated', 'pdf_failed', 'link_created', 'link_disabled', 'email_queued', 'email_sent', 'email_failed', 'payment_added', 'payment_updated', 'payment_deleted');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'proforma', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'issued', 'voided');--> statement-breakpoint
CREATE TYPE "public"."pdf_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_purpose" AS ENUM('document', 'verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('transfer', 'cash', 'card', 'other');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"description" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_item_price_nonnegative" CHECK ("catalog_item"."unit_price_cents" >= 0),
	CONSTRAINT "catalog_item_tax_rate_valid" CHECK ("catalog_item"."tax_rate" >= 0 AND "catalog_item"."tax_rate" < 100)
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"address" text,
	"email" text,
	"phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"address" text,
	"email" text NOT NULL,
	"phone" text,
	"logo_key" text,
	"default_due_days" integer DEFAULT 30 NOT NULL,
	"default_tax_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"retention_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_default_due_days_positive" CHECK ("company"."default_due_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"event" "document_event_type" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "document_series_next_number_positive" CHECK ("document_series"."next_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "document_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"line_subtotal_cents" integer DEFAULT 0 NOT NULL,
	"line_tax_cents" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_line_quantity_positive" CHECK ("document_line"."quantity" > 0),
	CONSTRAINT "document_line_price_nonnegative" CHECK ("document_line"."unit_price_cents" >= 0),
	CONSTRAINT "document_line_tax_rate_valid" CHECK ("document_line"."tax_rate" >= 0 AND "document_line"."tax_rate" < 100),
	CONSTRAINT "document_line_discount_percentage_valid" CHECK ("document_line"."discount_pct" >= 0 AND "document_line"."discount_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"series_id" uuid,
	"number" integer,
	"full_number" text,
	"client_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date,
	"notes" text,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"retention_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"issuer_snapshot" jsonb,
	"client_snapshot" jsonb,
	"converted_from_id" uuid,
	"converted_to_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"pdf_status" "pdf_status",
	"pdf_ready_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_issued_has_number" CHECK ("document"."status" = 'draft' OR "document"."number" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "email_purpose" NOT NULL,
	"company_id" uuid,
	"document_id" uuid,
	"user_id" uuid,
	"auth_verification_id" uuid,
	"requested_by" uuid,
	"idempotency_key" text NOT NULL,
	"recipient_email" text,
	"recipient_hash" text NOT NULL,
	"custom_message" text,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"confirmed_overpayment" boolean DEFAULT false NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"token" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_event" ADD CONSTRAINT "document_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_event" ADD CONSTRAINT "document_event_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_auth_verification_id_verification_id_fk" FOREIGN KEY ("auth_verification_id") REFERENCES "public"."verification"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "catalog_item_company_archived_idx" ON "catalog_item" USING btree ("company_id","archived_at");--> statement-breakpoint
CREATE INDEX "catalog_item_company_description_idx" ON "catalog_item" USING btree ("company_id","description");--> statement-breakpoint
CREATE INDEX "client_company_archived_idx" ON "client" USING btree ("company_id","archived_at");--> statement-breakpoint
CREATE INDEX "client_company_name_idx" ON "client" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "client_company_tax_id_idx" ON "client" USING btree ("company_id","tax_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_user_unique" ON "company" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_event_document_created_at_idx" ON "document_event" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_company_type_prefix_unique" ON "document_series" USING btree ("company_id","document_type","prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_company_type_default_unique" ON "document_series" USING btree ("company_id","document_type") WHERE "document_series"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "document_line_document_position_unique" ON "document_line" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "document_company_type_status_issue_date_idx" ON "document" USING btree ("company_id","document_type","status","issue_date");--> statement-breakpoint
CREATE INDEX "document_company_client_idx" ON "document" USING btree ("company_id","client_id");--> statement-breakpoint
CREATE INDEX "document_company_issued_at_idx" ON "document" USING btree ("company_id","issued_at");--> statement-breakpoint
CREATE INDEX "document_company_due_date_issued_invoice_idx" ON "document" USING btree ("company_id","due_date") WHERE "document"."status" = 'issued' AND "document"."document_type" = 'invoice';--> statement-breakpoint
CREATE UNIQUE INDEX "document_company_full_number_issued_unique" ON "document" USING btree ("company_id","full_number") WHERE "document"."status" IN ('issued', 'voided');--> statement-breakpoint
CREATE UNIQUE INDEX "document_payment_receipt_unique" ON "document" USING btree ("payment_id") WHERE "document"."document_type" = 'receipt';--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_idempotency_key_unique" ON "email_delivery" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_delivery_document_created_at_idx" ON "email_delivery" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_user_purpose_created_at_idx" ON "email_delivery" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "email_delivery_status_created_at_idx" ON "email_delivery" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_document_idx" ON "payment" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "payment_company_paid_on_idx" ON "payment" USING btree ("company_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "share_link_token_unique" ON "share_link" USING btree ("token");--> statement-breakpoint
CREATE INDEX "share_link_document_idx" ON "share_link" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_link_one_active_document_unique" ON "share_link" USING btree ("document_id") WHERE "share_link"."disabled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "client_name_trgm_idx" ON "client" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "client_tax_id_trgm_idx" ON "client" USING gin ("tax_id" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_item_description_trgm_idx" ON "catalog_item" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_converted_from_id_document_id_fk" FOREIGN KEY ("converted_from_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_converted_to_id_document_id_fk" FOREIGN KEY ("converted_to_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_invoice_id_document_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION prevent_document_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document_event is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER document_event_append_only BEFORE UPDATE OR DELETE ON "document_event" FOR EACH ROW EXECUTE FUNCTION prevent_document_event_mutation();
