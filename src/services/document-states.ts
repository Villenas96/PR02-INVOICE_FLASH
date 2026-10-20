import { type SQL, sql } from "drizzle-orm";
import { documents } from "@/db/schema/document";
import { documentLinks } from "@/db/schema/document-link";

/**
 * SQL twins of `deriveQuoteState` / `deriveDeliveryNoteState`
 * (src/lib/documents/conversion.ts): states are derived at query time and
 * never stored. `today` is the Europe/Madrid calendar day.
 */
export function quoteStateExpression(today: string): SQL<string | null> {
  return sql<string | null>`CASE
    WHEN ${documents.documentType} = 'quote' AND ${documents.status} = 'issued' THEN
      CASE
        WHEN EXISTS (
          SELECT 1 FROM ${documentLinks} quote_link
          JOIN ${documents} quote_target
            ON quote_target.id = quote_link.target_document_id
          WHERE quote_link.source_document_id = ${documents.id}
            AND quote_link.kind = 'converted'
            AND quote_link.released_at IS NULL
            AND quote_target.deleted_at IS NULL
            AND quote_target.status <> 'voided'
        ) THEN 'converted'
        WHEN ${documents.quoteDecision} IS NOT NULL THEN ${documents.quoteDecision}::text
        WHEN ${documents.validUntil} < ${today}::date THEN 'expired'
        ELSE 'pending'
      END
  END`;
}

export function deliveryNoteInvoicedExpression(): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${documentLinks} invoiced_link
    WHERE invoiced_link.source_document_id = ${documents.id}
      AND invoiced_link.kind = 'invoiced'
      AND invoiced_link.released_at IS NULL
  )`;
}

export function derivedStateExpression(today: string): SQL<string | null> {
  return sql<string | null>`CASE
    WHEN ${documents.documentType} = 'quote' THEN ${quoteStateExpression(today)}
    WHEN ${documents.documentType} = 'delivery_note'
      AND ${documents.status} = 'issued' THEN
      CASE WHEN ${deliveryNoteInvoicedExpression()} THEN 'invoiced' ELSE 'pending' END
  END`;
}
