ALTER TABLE "client" ADD COLUMN "logo_key" text;--> statement-breakpoint
CREATE INDEX "document_issuer_logo_key_idx" ON "document" USING btree (("issuer_snapshot" ->> 'logoKey'));--> statement-breakpoint
CREATE INDEX "document_client_logo_key_idx" ON "document" USING btree (("client_snapshot" ->> 'logoKey'));