import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { documentLinks } from "@/db/schema/document-link";
import { ApiError } from "@/lib/api/errors";
import { validateConversionSource } from "@/lib/documents/conversion";
import { createUuidV7 } from "@/lib/ids";
import type { DocumentType } from "@/lib/plan";
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
  documentType: DocumentType;
  status: "draft" | "issued" | "voided";
  /** Exact text of `updated_at` (microseconds), the optimistic claim token. */
  version: string;
  convertedToId: string | null;
}

/** Latest live invoice this document was converted into, if any. */
export async function findConvertedTarget(
  database: Database,
  sourceDocumentId: string,
): Promise<string | null> {
  const [link] = await database
    .select({ targetDocumentId: documentLinks.targetDocumentId })
    .from(documentLinks)
    .innerJoin(
      documents,
      and(
        eq(documents.id, documentLinks.targetDocumentId),
        isNull(documents.deletedAt),
      ),
    )
    .where(
      and(
        eq(documentLinks.sourceDocumentId, sourceDocumentId),
        eq(documentLinks.kind, "converted"),
        isNull(documentLinks.releasedAt),
      ),
    )
    .orderBy(desc(documentLinks.createdAt))
    .limit(1);
  return link?.targetDocumentId ?? null;
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
      version: sql<string>`${documents.updatedAt}::text`,
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
  return {
    ...source,
    convertedToId: await findConvertedTarget(database, source.id),
  };
}

interface CreateDraftRow extends Record<string, unknown> {
  invoice_id: string;
}

const MAX_CLAIM_ATTEMPTS = 3;

/**
 * Creates the invoice draft and its `converted` link in one statement. The
 * source row is claimed by bumping `updated_at` only if it still has the
 * version read before: of two concurrent conversions, Postgres rechecks the
 * second against the first one's new row version and it claims nothing, so
 * it reuses the winner's invoice instead of creating a second one.
 */
async function createOrReuseConvertedDraft(
  database: Database,
  companyId: string,
  actor: string,
  source: SourceRow,
  now: Date,
): Promise<string> {
  let current = source;
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    if (current.convertedToId) {
      return current.convertedToId;
    }
    const created = await insertConvertedDraft(
      database,
      companyId,
      actor,
      current,
      now,
    );
    if (created) {
      return created;
    }
    current = await loadSource(database, companyId, source.id);
  }
  throw new ApiError(
    "conflict",
    409,
    "La proforma ha cambiado mientras se convertía. Inténtalo de nuevo.",
  );
}

async function insertConvertedDraft(
  database: Database,
  companyId: string,
  actor: string,
  source: SourceRow,
  now: Date,
): Promise<string | null> {
  const newInvoiceId = createUuidV7(now.getTime());
  const linkId = createUuidV7(now.getTime());
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
      SET updated_at = ${nowIso}
      FROM scoped_company
      WHERE target.id = ${source.id}
        AND target.company_id = scoped_company.id
        AND target.document_type = 'proforma'::document_type
        AND target.status = 'issued'::document_status
        AND target.deleted_at IS NULL
        AND target.updated_at = ${source.version}::timestamptz
      RETURNING target.id, target.client_id, target.notes, target.subtotal_cents,
        target.tax_breakdown, target.retention_rate, target.retention_cents,
        target.total_cents, target.company_id, target.collection_method_id
    ),
    source_lines AS MATERIALIZED (
      SELECT line.position, line.description, line.quantity, line.unit_price_cents,
        line.tax_rate, line.discount_pct, line.unit, line.tax_rate_id,
        line.tax_name, line.catalog_item_id
      FROM ${documentLines} line
      JOIN claimed_proforma ON claimed_proforma.id = line.document_id
    ),
    inserted_invoice AS (
      INSERT INTO ${documents} (
        id, company_id, document_type, status, client_id, collection_method_id,
        issue_date, notes, subtotal_cents, tax_breakdown, retention_rate,
        retention_cents, total_cents, created_at, updated_at
      )
      SELECT
        ${newInvoiceId}, claimed_proforma.company_id, 'invoice'::document_type,
        'draft'::document_status, claimed_proforma.client_id,
        claimed_proforma.collection_method_id,
        ${nowIso}::date, claimed_proforma.notes, claimed_proforma.subtotal_cents,
        claimed_proforma.tax_breakdown, claimed_proforma.retention_rate,
        claimed_proforma.retention_cents, claimed_proforma.total_cents,
        ${nowIso}, ${nowIso}
      FROM claimed_proforma
      RETURNING id, company_id
    ),
    inserted_link AS (
      INSERT INTO ${documentLinks} (
        id, company_id, source_document_id, target_document_id, kind, created_at
      )
      SELECT ${linkId}, inserted_invoice.company_id, ${source.id},
        inserted_invoice.id, 'converted'::document_link_kind, ${nowIso}
      FROM inserted_invoice
      RETURNING id
    ),
    inserted_lines AS (
      INSERT INTO ${documentLines} (
        id, document_id, position, description, quantity, unit_price_cents,
        tax_rate, discount_pct, unit, tax_rate_id, tax_name, catalog_item_id
      )
      SELECT gen_random_uuid(), inserted_invoice.id, source_lines.position,
        source_lines.description, source_lines.quantity,
        source_lines.unit_price_cents, source_lines.tax_rate,
        source_lines.discount_pct, source_lines.unit, source_lines.tax_rate_id,
        source_lines.tax_name, source_lines.catalog_item_id
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
    JOIN inserted_link ON TRUE
    JOIN inserted_created_event ON TRUE
    JOIN inserted_converted_event ON TRUE
  `);

  return firstExecutionRow<CreateDraftRow>(result)?.invoice_id ?? null;
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
    source,
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
        source,
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
