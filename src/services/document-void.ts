import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError, ResourceNotFoundError } from "@/lib/api/errors";
import { createUuidV7 } from "@/lib/ids";

interface VoidedRow extends Record<string, unknown> {
  document_id: string;
}

async function loadVoidedDocument(
  database: Database,
  companyId: string,
  documentId: string,
) {
  const [document] = await database
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!document) {
    throw new ResourceNotFoundError();
  }
  if (document.status !== "voided") {
    throw new ApiError(
      "conflict",
      409,
      "Solo puedes anular documentos que ya estén emitidos.",
    );
  }
  return document;
}

export async function voidIssuedDocument(input: {
  database: Database;
  companyId: string;
  documentId: string;
  actor: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const eventId = createUuidV7(now.getTime());
  const nowIso = now.toISOString();
  const result = await input.database.execute<VoidedRow>(sql`
    WITH voided_document AS (
      UPDATE ${documents} target
      SET
        status = 'voided'::document_status,
        voided_at = ${nowIso},
        updated_at = ${nowIso}
      WHERE target.id = ${input.documentId}
        AND target.company_id = ${input.companyId}
        AND target.status = 'issued'::document_status
        AND target.deleted_at IS NULL
      RETURNING target.id, target.company_id
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        id,
        company_id,
        document_id,
        actor,
        event,
        created_at
      )
      SELECT
        ${eventId},
        voided_document.company_id,
        voided_document.id,
        ${input.actor},
        'voided'::document_event_type,
        ${nowIso}
      FROM voided_document
      RETURNING document_id
    )
    SELECT inserted_event.document_id
    FROM inserted_event
  `);

  const row = firstExecutionRow<VoidedRow>(result);
  if (!row) {
    const [existing] = await input.database
      .select({ status: documents.status })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.documentId),
          eq(documents.companyId, input.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new ResourceNotFoundError();
    }
    throw new ApiError(
      "conflict",
      409,
      existing.status === "voided"
        ? "El documento ya está anulado."
        : "Solo puedes anular documentos que ya estén emitidos.",
    );
  }

  return loadVoidedDocument(input.database, input.companyId, row.document_id);
}
