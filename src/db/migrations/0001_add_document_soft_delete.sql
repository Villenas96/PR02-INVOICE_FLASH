ALTER TABLE "document" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "document_company_deleted_at_idx" ON "document" USING btree ("company_id","deleted_at");