import { sql } from "drizzle-orm";

import type { Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";
import { ResourceNotFoundError } from "@/services/context";

/**
 * Accepted/rejected quote (FR-035): operational state, not fiscal content —
 * the issued snapshot and PDF never change; every change is an event.
 */
export async function decideQuote(input: {
  database: Database;
  companyId: string;
  documentId: string;
  actor: string;
  decision: "accepted" | "rejected";
  now?: Date;
}): Promise<{ decision: "accepted" | "rejected"; decidedAt: string }> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const result = await input.database.execute<{ decided_at: string }>(sql`
    WITH decided AS (
      UPDATE ${documents} quote
      SET quote_decision = ${input.decision}::quote_decision,
        quote_decided_at = ${nowIso},
        updated_at = ${nowIso}
      WHERE quote.id = ${input.documentId}
        AND quote.company_id = ${input.companyId}
        AND quote.document_type = 'quote'::document_type
        AND quote.status = 'issued'::document_status
        AND quote.deleted_at IS NULL
      RETURNING quote.id, quote.company_id, quote.quote_decided_at
    ),
    event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, created_at)
      SELECT ${createUuidV7(now.getTime())}, decided.company_id, decided.id,
        ${input.actor},
        ${input.decision === "accepted" ? "quote_accepted" : "quote_rejected"}::document_event_type,
        ${nowIso}
      FROM decided
      RETURNING document_id
    )
    SELECT decided.quote_decided_at::text AS decided_at
    FROM decided JOIN event ON TRUE
  `);
  const row = firstExecutionRow<{ decided_at: string }>(result);
  if (row) {
    return { decision: input.decision, decidedAt: row.decided_at };
  }
  const exists = await input.database.execute<{ document_type: string }>(sql`
    SELECT document_type::text FROM ${documents}
    WHERE id = ${input.documentId} AND company_id = ${input.companyId}
      AND deleted_at IS NULL
  `);
  if (!firstExecutionRow(exists)) {
    throw new ResourceNotFoundError();
  }
  throw new ApiError(
    "conflict",
    409,
    "Solo puedes aceptar o rechazar presupuestos emitidos y no anulados.",
  );
}
