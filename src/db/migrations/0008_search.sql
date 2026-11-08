CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD COLUMN "search_text" text GENERATED ALWAYS AS (immutable_unaccent(lower(description))) STORED;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "search_text" text GENERATED ALWAYS AS (immutable_unaccent(lower(coalesce(name, '') || ' ' || coalesce(tax_id, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(address, '') || ' ' || coalesce(postal_code, '') || ' ' || coalesce(city, '')))) STORED;--> statement-breakpoint
CREATE INDEX "catalog_item_search_text_trgm_idx" ON "catalog_item" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "client_search_text_trgm_idx" ON "client" USING gin ("search_text" gin_trgm_ops);