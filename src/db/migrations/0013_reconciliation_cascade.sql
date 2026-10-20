ALTER TABLE "reconciliation" DROP CONSTRAINT "reconciliation_payment_id_payment_id_fk";
--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;