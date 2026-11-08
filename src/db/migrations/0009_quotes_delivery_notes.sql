CREATE TYPE "public"."document_link_kind" AS ENUM('converted', 'invoiced');--> statement-breakpoint
CREATE TYPE "public"."quote_decision" AS ENUM('accepted', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'quote';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'delivery_note';--> statement-breakpoint
CREATE TABLE "document_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"target_document_id" uuid NOT NULL,
	"kind" "document_link_kind" NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "section_label" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "quote_decision" "quote_decision";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "quote_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_source_document_id_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_target_document_id_document_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_link_invoiced_source_unique" ON "document_link" USING btree ("source_document_id") WHERE "document_link"."kind" = 'invoiced' AND "document_link"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "document_link_target_idx" ON "document_link" USING btree ("target_document_id");--> statement-breakpoint
CREATE INDEX "document_link_source_kind_idx" ON "document_link" USING btree ("source_document_id","kind");--> statement-breakpoint
CREATE INDEX "document_company_type_quote_decision_idx" ON "document" USING btree ("company_id","document_type","quote_decision");--> statement-breakpoint
CREATE INDEX "document_company_client_type_status_idx" ON "document" USING btree ("company_id","client_id","document_type","status");;--> statement-breakpoint
INSERT INTO "document_link" ("id", "company_id", "source_document_id", "target_document_id", "kind", "released_at", "created_at")
SELECT gen_random_uuid(), target."company_id", target."converted_from_id", target."id", 'converted', NULL, target."created_at"
FROM "document" target
JOIN "document" source ON source."id" = target."converted_from_id" AND source."company_id" = target."company_id";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "converted_from_id";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "converted_to_id";