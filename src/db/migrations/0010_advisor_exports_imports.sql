CREATE TYPE "public"."access_event_action" AS ENUM('session_started', 'exported', 'downloaded_pdf', 'access_revoked');--> statement-breakpoint
CREATE TYPE "public"."advisor_schedule_frequency" AS ENUM('monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."company_access_role" AS ENUM('advisor');--> statement-breakpoint
CREATE TYPE "public"."company_access_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."export_kind" AS ENUM('period_excel', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'ready', 'empty', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_duplicate_policy" AS ENUM('skip', 'update');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('catalog', 'bank_statement');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'analyzing', 'preview_ready', 'applying', 'done', 'failed', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."email_purpose" ADD VALUE IF NOT EXISTS 'advisor_export';--> statement-breakpoint
ALTER TYPE "public"."email_purpose" ADD VALUE IF NOT EXISTS 'advisor_invite';--> statement-breakpoint
ALTER TYPE "public"."email_purpose" ADD VALUE IF NOT EXISTS 'user_notice';--> statement-breakpoint
CREATE TABLE "access_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" "access_event_action" NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_schedule" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"frequency" "advisor_schedule_frequency" NOT NULL,
	"formats" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_period_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"role" "company_access_role" DEFAULT 'advisor' NOT NULL,
	"status" "company_access_status" DEFAULT 'pending' NOT NULL,
	"invited_email_hash" text NOT NULL,
	"invite_token_hash" text NOT NULL,
	"invite_expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"kind" "export_kind" NOT NULL,
	"filters" jsonb NOT NULL,
	"formats" text[] NOT NULL,
	"period_key" text,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"file_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"download_token_hash" text,
	"expires_at" timestamp with time zone,
	"send_to_advisor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "import_kind" NOT NULL,
	"file_key" text NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"mapping" jsonb,
	"duplicate_policy" "import_duplicate_policy",
	"preview" jsonb,
	"result" jsonb,
	"row_count" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_company_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "source_import_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "advisor_email" text;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD COLUMN "export_job_id" uuid;--> statement-breakpoint
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_schedule" ADD CONSTRAINT "advisor_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_event_company_created_at_idx" ON "access_event" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_event_session_started_daily_unique" ON "access_event" USING btree ("company_id","actor_user_id",(("created_at" AT TIME ZONE 'Europe/Madrid')::date)) WHERE "access_event"."action" = 'session_started';--> statement-breakpoint
CREATE UNIQUE INDEX "company_access_invite_token_hash_unique" ON "company_access" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "company_access_company_user_active_unique" ON "company_access" USING btree ("company_id","user_id") WHERE "company_access"."status" = 'active';--> statement-breakpoint
CREATE INDEX "company_access_user_status_idx" ON "company_access" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "company_access_company_status_idx" ON "company_access" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "export_job_download_token_hash_unique" ON "export_job" USING btree ("download_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "export_job_system_period_unique" ON "export_job" USING btree ("company_id","period_key") WHERE "export_job"."requested_by" = 'system';--> statement-breakpoint
CREATE INDEX "export_job_company_created_at_idx" ON "export_job" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "export_job_expires_at_idx" ON "export_job" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "import_job_company_created_at_idx" ON "import_job" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_source_import_id_import_job_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_export_job_id_export_job_id_fk" FOREIGN KEY ("export_job_id") REFERENCES "public"."export_job"("id") ON DELETE restrict ON UPDATE no action;