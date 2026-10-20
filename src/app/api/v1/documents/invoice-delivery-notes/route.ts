import { z } from "zod";

import { createDatabase } from "@/db";
import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { runRoute } from "@/lib/api/route";
import { parseJson } from "@/lib/api/validate";
import { getQueue } from "@/lib/cloudflare";
import { resolveCompanyContext } from "@/services/context";
import {
  invoiceDeliveryNotes,
  invoiceDeliveryNotesAndIssue,
} from "@/services/delivery-note-invoicing";

const bodySchema = z
  .object({
    delivery_note_ids: z.array(z.string().uuid()).min(1).max(100),
    issue: z.boolean().optional().default(false),
  })
  .strict();

/**
 * One invoice from several delivery notes of the same client (FR-036,
 * FR-037). Requires `Idempotency-Key`; an already invoiced note answers
 * `409 delivery_note_already_invoiced` with the invoice number.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(
    request,
    "documents.invoice_delivery_notes_failed",
    async () => {
      const [context, input] = await Promise.all([
        resolveCompanyContext(request, { access: "write" }),
        parseJson(request, bodySchema),
      ]);
      const idempotencyKey = parseIdempotencyKey(request, true) as string;
      const common = {
        companyId: context.companyId,
        actor: context.userId,
        deliveryNoteIds: input.delivery_note_ids,
        idempotencyKey,
      };
      if (input.issue) {
        const issued = await invoiceDeliveryNotesAndIssue(common, {
          database: createDatabase(),
          queue: await getQueue("PDF_RENDER_QUEUE"),
        });
        return Response.json(
          {
            id: issued.id,
            doc_type: issued.documentType,
            status: issued.status,
            full_number: issued.fullNumber,
            total_cents: issued.totalCents,
          },
          { status: 201 },
        );
      }
      const draft = await invoiceDeliveryNotes(common);
      return Response.json({ id: draft.id, status: "draft" }, { status: 201 });
    },
  );
}
