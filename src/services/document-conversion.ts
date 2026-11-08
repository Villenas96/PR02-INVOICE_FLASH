import { and, eq, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { documentLinks } from "@/db/schema/document-link";
import { ApiError } from "@/lib/api/errors";
import { validateConversion } from "@/lib/documents/conversion";
import { documentTypeLabel } from "@/lib/documents/labels";
import { createUuidV7, deterministicUuid } from "@/lib/ids";
import type { DocumentType } from "@/lib/plan";
import { ResourceNotFoundError } from "@/services/context";
import { invoiceDeliveryNotes } from "@/services/delivery-note-invoicing";
import {
  type IssueDocumentDependencies,
  type IssuedDocumentResult,
  issueDocument,
} from "@/services/document-issuance";
import { liveConversions } from "@/services/document-links";

export interface ConversionResult {
  id: string;
  status: "draft" | "issued";
}

export interface ConvertDocumentInput {
  database?: Database;
  companyId: string;
  documentId: string;
  actor: string;
  targetType: DocumentType;
  /** Converting the same source to the same type again (FR-036). */
  confirmRepeat?: boolean;
  /** Same key → same target: a redelivered request never duplicates. */
  idempotencyKey?: string;
  now?: Date;
}

interface SourceRow {
  id: string;
  documentType: DocumentType;
  status: "draft" | "issued" | "voided";
  /** Exact text of `updated_at` (microseconds), the optimistic claim token. */
  version: string;
}

const MAX_CLAIM_ATTEMPTS = 3;

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
  return source;
}

async function existingTarget(
  database: Database,
  companyId: string,
  targetId: string,
): Promise<string | null> {
  const [target] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, targetId), eq(documents.companyId, companyId)))
    .limit(1);
  return target?.id ?? null;
}

function notAllowedError(
  source: SourceRow,
  targetType: DocumentType,
): ApiError {
  const message =
    source.status === "voided"
      ? "No puedes convertir un documento anulado."
      : source.status !== "issued"
        ? "Emite el documento antes de convertirlo."
        : `No puedes convertir un ${documentTypeLabel(source.documentType).toLowerCase()} en ${documentTypeLabel(targetType).toLowerCase()}.`;
  return new ApiError("conversion_not_allowed", 409, message);
}

/**
 * Creates the target draft, its lines, the `converted` link and the events
 * in one statement. The source row is claimed by bumping `updated_at` only if
 * it still has the version read before: of two concurrent conversions the
 * second claims nothing and re-evaluates the repeat rule.
 */
async function insertConvertedDraft(
  database: Database,
  input: {
    companyId: string;
    actor: string;
    source: SourceRow;
    targetType: DocumentType;
    targetId: string;
    now: Date;
  },
): Promise<string | null> {
  const { source, now } = input;
  const nowIso = now.toISOString();
  const linkId = createUuidV7(now.getTime());
  const createdEventId = createUuidV7(now.getTime());
  const convertedEventId = createUuidV7(now.getTime());
  const linkedEventId = createUuidV7(now.getTime());

  const result = await database.execute<{ target_id: string }>(sql`
    WITH scoped_company AS MATERIALIZED (
      SELECT ${companies.id} AS id
      FROM ${companies}
      WHERE ${companies.id} = ${input.companyId}
    ),
    claimed_source AS (
      UPDATE ${documents} source
      SET updated_at = ${nowIso}
      FROM scoped_company
      WHERE source.id = ${source.id}
        AND source.company_id = scoped_company.id
        AND source.status = 'issued'::document_status
        AND source.deleted_at IS NULL
        AND source.updated_at = ${source.version}::timestamptz
      RETURNING source.id, source.client_id, source.notes, source.subtotal_cents,
        source.tax_breakdown, source.retention_rate, source.retention_cents,
        source.total_cents, source.company_id, source.collection_method_id
    ),
    source_lines AS MATERIALIZED (
      SELECT line.position, line.description, line.quantity, line.unit_price_cents,
        line.tax_rate, line.discount_pct, line.unit, line.tax_rate_id,
        line.tax_name, line.catalog_item_id, line.section_label,
        line.line_subtotal_cents, line.line_tax_cents, line.line_total_cents
      FROM ${documentLines} line
      JOIN claimed_source ON claimed_source.id = line.document_id
    ),
    inserted_target AS (
      INSERT INTO ${documents} (
        id, company_id, document_type, status, client_id, collection_method_id,
        issue_date, notes, subtotal_cents, tax_breakdown, retention_rate,
        retention_cents, total_cents, created_at, updated_at
      )
      SELECT
        ${input.targetId}::uuid, claimed_source.company_id,
        ${input.targetType}::document_type, 'draft'::document_status,
        claimed_source.client_id, claimed_source.collection_method_id,
        ${nowIso}::date, claimed_source.notes, claimed_source.subtotal_cents,
        claimed_source.tax_breakdown, claimed_source.retention_rate,
        claimed_source.retention_cents, claimed_source.total_cents,
        ${nowIso}, ${nowIso}
      FROM claimed_source
      RETURNING id, company_id
    ),
    inserted_link AS (
      INSERT INTO ${documentLinks} (
        id, company_id, source_document_id, target_document_id, kind, created_at
      )
      SELECT ${linkId}, inserted_target.company_id, ${source.id},
        inserted_target.id, 'converted'::document_link_kind, ${nowIso}
      FROM inserted_target
      RETURNING id
    ),
    inserted_lines AS (
      INSERT INTO ${documentLines} (
        id, document_id, position, description, quantity, unit_price_cents,
        tax_rate, discount_pct, unit, tax_rate_id, tax_name, catalog_item_id,
        section_label, line_subtotal_cents, line_tax_cents, line_total_cents
      )
      SELECT gen_random_uuid(), inserted_target.id, source_lines.position,
        source_lines.description, source_lines.quantity,
        source_lines.unit_price_cents, source_lines.tax_rate,
        source_lines.discount_pct, source_lines.unit, source_lines.tax_rate_id,
        source_lines.tax_name, source_lines.catalog_item_id,
        source_lines.section_label, source_lines.line_subtotal_cents,
        source_lines.line_tax_cents, source_lines.line_total_cents
      FROM inserted_target
      CROSS JOIN source_lines
      RETURNING id
    ),
    line_barrier AS (
      SELECT count(*) AS inserted_count FROM inserted_lines
    ),
    inserted_created_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
      SELECT ${createdEventId}, inserted_target.company_id, inserted_target.id,
        ${input.actor}, 'created'::document_event_type,
        jsonb_build_object('converted_from_id', ${source.id}::text), ${nowIso}
      FROM inserted_target
      CROSS JOIN line_barrier
      RETURNING document_id
    ),
    inserted_linked_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
      SELECT ${linkedEventId}, inserted_target.company_id, inserted_target.id,
        ${input.actor}, 'linked'::document_event_type,
        jsonb_build_object('source_id', ${source.id}::text, 'kind', 'converted'),
        ${nowIso}
      FROM inserted_target
      JOIN inserted_link ON TRUE
      RETURNING document_id
    ),
    inserted_converted_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
      SELECT ${convertedEventId}, claimed_source.company_id, claimed_source.id,
        ${input.actor}, 'converted'::document_event_type,
        jsonb_build_object(
          'converted_to_id', inserted_target.id,
          'target_type', ${input.targetType}::text
        ),
        ${nowIso}
      FROM claimed_source
      JOIN inserted_target ON TRUE
      RETURNING document_id
    )
    SELECT inserted_target.id AS target_id
    FROM inserted_target
    JOIN inserted_created_event ON TRUE
    JOIN inserted_linked_event ON TRUE
    JOIN inserted_converted_event ON TRUE
  `);
  return firstExecutionRow<{ target_id: string }>(result)?.target_id ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error: the Postgres code is on `cause`.
  for (
    let current: unknown = error, depth = 0;
    current && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, message } = current as { code?: string; message?: string };
    if (code === "23505" || message?.includes("duplicate key")) {
      return true;
    }
  }
  return false;
}

/**
 * Converts an issued document into a draft of `targetType` along the
 * transition table (research R4). Repeats need `confirmRepeat`; a repeated
 * `idempotencyKey` returns the document it already created.
 */
export async function convertDocument(
  input: ConvertDocumentInput,
): Promise<ConversionResult> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const targetId = input.idempotencyKey
    ? await deterministicUuid(
        input.companyId,
        input.documentId,
        input.targetType,
        input.idempotencyKey,
      )
    : null;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    if (targetId) {
      const existing = await existingTarget(
        database,
        input.companyId,
        targetId,
      );
      if (existing) {
        return { id: existing, status: "draft" };
      }
    }
    const source = await loadSource(
      database,
      input.companyId,
      input.documentId,
    );
    if (
      source.documentType === "delivery_note" &&
      input.targetType === "invoice"
    ) {
      // A delivery note is billed (`invoiced` link, once while live), not
      // converted: same path as invoicing several notes (FR-037).
      const invoice = await invoiceDeliveryNotes({
        database,
        companyId: input.companyId,
        actor: input.actor,
        deliveryNoteIds: [source.id],
        idempotencyKey: input.idempotencyKey ?? createUuidV7(now.getTime()),
        now,
      });
      return { id: invoice.id, status: "draft" };
    }
    const previous = await liveConversions(
      database,
      source.id,
      input.targetType,
    );
    const validation = validateConversion({
      source,
      targetType: input.targetType,
      existingTargets: previous.length,
      confirmRepeat: input.confirmRepeat ?? false,
    });
    if (!validation.valid) {
      if (targetId) {
        // A concurrent request with the same key may have just created it.
        const winner = await existingTarget(
          database,
          input.companyId,
          targetId,
        );
        if (winner) {
          return { id: winner, status: "draft" };
        }
      }
      if (validation.error === "conversion_not_allowed") {
        throw notAllowedError(source, input.targetType);
      }
      throw new ApiError(
        "conversion_repeat_confirmation_required",
        409,
        `Este documento ya se convirtió en ${documentTypeLabel(input.targetType).toLowerCase()}. Confirma si quieres crear otro.`,
        undefined,
        {
          existing: previous.map((target) => ({
            id: target.id,
            full_number: target.fullNumber,
          })),
        },
      );
    }

    let created: string | null;
    try {
      created = await insertConvertedDraft(database, {
        companyId: input.companyId,
        actor: input.actor,
        source,
        targetType: input.targetType,
        targetId: targetId ?? createUuidV7(now.getTime()),
        now,
      });
    } catch (error) {
      // A concurrent request with the same key inserted the same id first.
      if (targetId && isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
    if (created) {
      return { id: created, status: "draft" };
    }
  }
  throw new ApiError(
    "conflict",
    409,
    "El documento ha cambiado mientras se convertía. Inténtalo de nuevo.",
  );
}

/**
 * Direct-issue conversion (`issue: true`): ensures the target draft exists,
 * then routes it through the shared issuance guard, so the destination
 * type's monthly quota applies (402 when exhausted) and a redelivered
 * request returns the already issued document.
 */
export async function convertAndIssue(
  input: ConvertDocumentInput,
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  const database = dependencies.database ?? input.database ?? createDatabase();
  const now = dependencies.now ?? input.now ?? new Date();
  const target = await convertDocument({ ...input, database, now });
  return issueDocument(
    {
      companyId: input.companyId,
      documentId: target.id,
      actor: input.actor,
      idempotency: {
        kind: "converted_from",
        sourceDocumentId: input.documentId,
      },
    },
    { ...dependencies, database, now },
  );
}

/** v1 entry points (proforma → invoice), kept for existing callers. */
export function convertProformaToDraft(input: {
  database?: Database;
  companyId: string;
  documentId: string;
  actor: string;
  confirmRepeat?: boolean;
  idempotencyKey?: string;
  now?: Date;
}): Promise<ConversionResult> {
  return convertDocument({ ...input, targetType: "invoice" });
}

export function convertProformaAndIssue(
  input: {
    companyId: string;
    documentId: string;
    actor: string;
    confirmRepeat?: boolean;
    idempotencyKey?: string;
    now?: Date;
  },
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  return convertAndIssue({ ...input, targetType: "invoice" }, dependencies);
}
