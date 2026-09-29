DROP FUNCTION IF EXISTS prevent_document_event_mutation();
--> statement-breakpoint
DROP TABLE IF EXISTS "share_link";
--> statement-breakpoint
DROP TABLE IF EXISTS "payment";
--> statement-breakpoint
DROP TABLE IF EXISTS "email_delivery";
--> statement-breakpoint
DROP TABLE IF EXISTS "document_line";
--> statement-breakpoint
DROP TABLE IF EXISTS "document_event";
--> statement-breakpoint
DROP TABLE IF EXISTS "document";
--> statement-breakpoint
DROP TABLE IF EXISTS "document_series";
--> statement-breakpoint
DROP TABLE IF EXISTS "client";
--> statement-breakpoint
DROP TABLE IF EXISTS "catalog_item";
--> statement-breakpoint
DROP TABLE IF EXISTS "company";
--> statement-breakpoint
DROP TABLE IF EXISTS "account";
--> statement-breakpoint
DROP TABLE IF EXISTS "session";
--> statement-breakpoint
DROP TABLE IF EXISTS "verification";
--> statement-breakpoint
DROP TABLE IF EXISTS "user";
--> statement-breakpoint
DROP TYPE IF EXISTS "payment_method";
--> statement-breakpoint
DROP TYPE IF EXISTS "email_purpose";
--> statement-breakpoint
DROP TYPE IF EXISTS "email_delivery_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "pdf_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "document_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "document_type";
--> statement-breakpoint
DROP TYPE IF EXISTS "document_event_type";
--> statement-breakpoint
DROP TYPE IF EXISTS "plan";
--> statement-breakpoint
DROP EXTENSION IF EXISTS pg_trgm;
