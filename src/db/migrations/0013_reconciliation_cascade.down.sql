BEGIN;

ALTER TABLE "reconciliation" DROP CONSTRAINT IF EXISTS "reconciliation_payment_id_payment_id_fk";
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;

COMMIT;
