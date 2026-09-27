import { and, eq, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError } from "@/lib/api/errors";
import { validateConversionSource } from "@/lib/documents/conversion";
import { createUuidV7 } from "@/lib/ids";
import { ResourceNotFoundError } from "@/services/context";
import {
  type IssueDocumentDependencies,
  type IssuedDocumentResult,
  issueDocument,
} from "@/services/document-issuance";

export interface ConversionResult {
  id: string;
  status: "draft" | "issued";
}

function conversionConflictError(
  error: "already_voided" | "not_a_proforma" | "not_issued",
): ApiError {
  const messages = {
    not_a_proforma: "Solo puedes convertir proformas en facturas.",
    not_issued: "Solo puedes convertir proformas emitidas.",
    already_voided: "No puedes convertir una proforma anulada.",
  } as const;
  return new ApiError("conflict", 409, messages[error]);
}

interface SourceRow {
  id: string;
  documentType: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
  convertedToId: string | null;
}

async function loadSource(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<SourceRow> {
  const [source] = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      status: documents.status,
      convertedToId: documents.convertedToId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!source) {
    throw new ResourceNotFoundError();
  }
  return source;
}

interface CreateDraftRow extends Record<string, unknown> {
  invoice_id: string;
}

/**
 * Atomically links the proforma to a brand-new invoice draft the first time
 * it is converted; the `converted_to_id IS NULL` guard on the UPDATE makes a
 * concurrent double-conversion resolve to a single winner.
 */
async function createOrReuseConvertedDraft(
  database: Database,
  companyId: string,
  actor: string,
  proformaId: string,
  now: Date,
): Promise<string> {
  const newInvoiceId = createUuidV7(now.getTime());
  const createdEventId = createUuidV7(now.getTime());
  const convertedEventId = createUuidV7(now.getTime());
  const nowIso = now.toISOString();

  const result = await database.execute<CreateDraftRow>(sql`
    WITH scoped_company AS MATERIALIZED (
      SELECT ${companies.id} AS id
      FROM ${companies}
      WHERE ${companies.id} = ${companyId} AND ${companies.userId} = ${actor}
    ),
    claimed_proforma AS (
      UPDATE ${documents} target
      SET converted_to_id = ${newInvoiceId}, updated_at = ${nowIso}
      FROM scoped_company
      WHERE target.id = ${proformaId}
        AND target.company_id = scoped_company.id
        AND target.document_type = 'proforma'::document_type
        AND target.status = 'issued'::document_status
        AND target.deleted_at IS NULL
        AND target.converted_to_id IS NULL
      RETURNING target.id, target.client_id, target.notes, target.subtotal_cents,
        target.tax_breakdown, target.retention_rate, target.retention_cents,
        target.total_cents, target.company_id
    ),
    source_lines AS MATERIALIZED (
      SELECT line.position, line.description, line.quantity, line.unit_price_cents,
        line.tax_rate, line.discount_pct
      FROM ${documentLines} line
      JOIN claimed_proforma ON claimed_proforma.id = line.document_id
    ),
    inserted_invoice AS (
      INSERT INTO ${documents} (
        id, company_id, document_type, status, client_id, converted_from_id,
        issue_date, notes, subtotal_cents, tax_breakdown, retention_rate,
        retention_cents, total_cents, created_at, updated_at
      )
      SELECT
        ${newInvoiceId}, claimed_proforma.company_id, 'invoice'::document_type,
        'draft'::document_status, claimed_proforma.client_id, claimed_proforma.id,
        ${nowIso}::date, claimed_proforma.notes, claimed_proforma.subtotal_cents,
        claimed_proforma.tax_breakdown, claimed_proforma.retention_rate,
        claimed_proforma.retention_cents, claimed_proforma.total_cents,
        ${nowIso}, ${nowIso}
      FROM claimed_proforma
      RETURNING id, company_id
    ),
    inserted_lines AS (
      INSERT INTO ${documentLines} (
        id, document_id, position, description, quantity, unit_price_cents,
        tax_rate, discount_pct
      )
      SELECT gen_random_uuid(), inserted_invoice.id, source_lines.position,
        source_lines.description, source_lines.quantity,
        source_lines.unit_price_cents, source_lines.tax_rate,
        source_lines.discount_pct
      FROM inserted_invoice
      CROSS JOIN source_lines
      RETURNING id
    ),
    line_barrier AS (
      SELECT count(*) AS inserted_count FROM inserted_lines
    ),
    inserted_created_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, created_at)
      SELECT ${createdEventId}, inserted_invoice.company_id, inserted_invoice.id,
        ${actor}, 'created'::document_event_type, ${nowIso}
      FROM inserted_invoice
      CROSS JOIN line_barrier
      RETURNING document_id
    ),
    inserted_converted_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
      SELECT ${convertedEventId}, claimed_proforma.company_id, claimed_proforma.id,
        ${actor}, 'converted'::document_event_type,
        jsonb_build_object('converted_to_id', inserted_invoice.id), ${nowIso}
      FROM claimed_proforma
      JOIN inserted_invoice ON TRUE
      RETURNING document_id
    )
    SELECT inserted_invoice.id AS invoice_id
    FROM inserted_invoice
    JOIN inserted_created_event ON TRUE
    JOIN inserted_converted_event ON TRUE
  `);

  const row = firstExecutionRow<CreateDraftRow>(result);
  if (row) {
    return row.invoice_id;
  }

  // A concurrent conversion won the race against the `converted_to_id IS
  // NULL` guard first; its linked invoice is now visible to us.
  const [claimed] = await database
    .select({ convertedToId: documents.convertedToId })
    .from(documents)
    .where(eq(documents.id, proformaId));
  if (!claimed?.convertedToId) {
    throw new Error("No se ha podido convertir la proforma en factura.");
  }
  return claimed.convertedToId;
}

/**
 * Draft-mode conversion (`{issue:false}` or omitted): resolves or creates the
 * linked invoice draft and returns it without touching plan quota.
 */
export async function convertProformaToDraft(input: {
  database?: Database;
  companyId: string;
  documentId: string;
  actor: string;
  now?: Date;
}): Promise<ConversionResult> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const source = await loadSource(database, input.companyId, input.documentId);

  if (source.convertedToId) {
    return { id: source.convertedToId, status: "draft" };
  }

  const validation = validateConversionSource(source);
  if (!validation.valid) {
    throw conversionConflictError(
      validation.error === "already_converted"
        ? "not_issued"
        : validation.error,
    );
  }

  const invoiceId = await createOrReuseConvertedDraft(
    database,
    input.companyId,
    input.actor,
    input.documentId,
    now,
  );
  return { id: invoiceId, status: "draft" };
}

/**
 * Direct-issue conversion (`{issue:true}`): ensures the linked draft exists,
 * then routes it through the shared issuance guard (T053) with a
 * `converted_from` idempotency strategy so a resolved existing invoice never
 * consumes another plan slot.
 */
export async function convertProformaAndIssue(
  input: {
    companyId: string;
    documentId: string;
    actor: string;
    now?: Date;
  },
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? input.now ?? new Date();
  const source = await loadSource(database, input.companyId, input.documentId);

  if (!source.convertedToId) {
    const validation = validateConversionSource(source);
    if (!validation.valid) {
      throw conversionConflictError(
        validation.error === "already_converted"
          ? "not_issued"
          : validation.error,
      );
    }
  }

  const invoiceId = source.convertedToId
    ? source.convertedToId
    : await createOrReuseConvertedDraft(
        database,
        input.companyId,
        input.actor,
        input.documentId,
        now,
      );

  return issueDocument(
    {
      companyId: input.companyId,
      documentId: invoiceId,
      actor: input.actor,
      idempotency: {
        kind: "converted_from",
        sourceDocumentId: input.documentId,
      },
    },
    { ...dependencies, database, now },
  );
}
