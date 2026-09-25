import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { executionRows } from "@/db/result";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { type BillingResult, calculateBilling } from "@/lib/billing";
import { createUuidV7 } from "@/lib/ids";
import { createCents } from "@/lib/money";
import { ResourceNotFoundError } from "@/services/context";

const MAX_DRAFT_LINES = 500;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const decimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim());
const nullableUuidSchema = z.string().uuid().nullable();
const draftLineSchema = z
  .object({
    description: z.string().trim().min(1).max(1_000),
    quantity: decimalSchema,
    unitPriceCents: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    taxRate: decimalSchema,
    discountPercentage: decimalSchema.default("0"),
  })
  .strict();
const draftFieldsSchema = z.object({
  documentType: z.enum(["invoice", "proforma"]),
  clientId: nullableUuidSchema.default(null),
  issueDate: z.iso.date(),
  dueDate: z.iso.date().nullable().default(null),
  notes: z.string().trim().max(5_000).nullable().default(null),
  lines: z.array(draftLineSchema).max(MAX_DRAFT_LINES),
});
const createDraftSchema = draftFieldsSchema
  .extend({
    companyId: z.string().uuid(),
    actor: z.string().uuid(),
  })
  .strict();
const updateDraftSchema = z
  .object({
    companyId: z.string().uuid(),
    documentId: z.string().uuid(),
    actor: z.string().uuid(),
    documentType: z.enum(["invoice", "proforma"]).optional(),
    clientId: nullableUuidSchema.optional(),
    issueDate: z.iso.date().optional(),
    dueDate: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    lines: z.array(draftLineSchema).max(MAX_DRAFT_LINES).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.documentType !== undefined ||
      value.clientId !== undefined ||
      value.issueDate !== undefined ||
      value.dueDate !== undefined ||
      value.notes !== undefined ||
      value.lines !== undefined,
    { message: "Indica al menos un dato para actualizar." },
  );
const deleteDraftSchema = z
  .object({
    companyId: z.string().uuid(),
    documentId: z.string().uuid(),
    actor: z.string().uuid(),
  })
  .strict();

export type DraftLineInput = z.input<typeof draftLineSchema>;
export type CreateDraftDocumentInput = z.input<typeof createDraftSchema>;
export type UpdateDraftDocumentInput = z.input<typeof updateDraftSchema>;
export type SoftDeleteDraftDocumentInput = z.input<typeof deleteDraftSchema>;

export interface DocumentDetailProjection {
  documentType: "invoice" | "proforma" | "receipt";
  fullNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  subtotalCents: number;
  taxBreakdown: unknown;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  issuerSnapshot: unknown;
  clientSnapshot: unknown;
  lines: ReadonlyArray<{
    position: number;
    description: string;
    quantity: string;
    unitPriceCents: number;
    taxRate: string;
    lineSubtotalCents: number;
    lineTaxCents: number;
    lineTotalCents: number;
  }>;
}

export type DocumentDetail = typeof documents.$inferSelect & {
  lines: Array<typeof documentLines.$inferSelect>;
};

export interface DocumentServiceDependencies {
  database?: Database;
  now?: Date;
}

interface PreparedLine {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price_cents: number;
  tax_rate: string;
  discount_percentage: string;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
}

interface CompanyForDraft {
  id: string;
  retentionRate: string;
}

function databaseFrom(dependencies?: DocumentServiceDependencies): Database {
  return dependencies?.database ?? createDatabase();
}

function validationError(error: unknown): ApiError {
  return new ApiError(
    "validation_error",
    400,
    "Revisa las líneas del documento e inténtalo de nuevo.",
    {
      lines:
        error instanceof Error
          ? error.message
          : "Las líneas del documento no son válidas.",
    },
  );
}

function emptyBilling(): BillingResult {
  return {
    lines: [],
    taxBreakdown: [],
    subtotalCents: createCents(0),
    retentionCents: createCents(0),
    totalCents: createCents(0),
  };
}

function calculateDraftBilling(
  lines: z.output<typeof draftLineSchema>[],
  retentionRate: string,
): BillingResult {
  if (lines.length === 0) {
    return emptyBilling();
  }

  try {
    return calculateBilling({
      lines: lines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: createCents(line.unitPriceCents),
        taxRate: line.taxRate,
        discountPercentage: line.discountPercentage,
      })),
      retentionRate,
    });
  } catch (error) {
    throw validationError(error);
  }
}

function prepareLines(
  lines: z.output<typeof draftLineSchema>[],
  billing: BillingResult,
  now: Date,
): PreparedLine[] {
  return lines.map((line, index) => {
    const calculatedLine = billing.lines[index];
    if (!calculatedLine) {
      throw new Error("No se ha podido calcular una línea del documento.");
    }

    return {
      id: createUuidV7(now.getTime()),
      position: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      tax_rate: line.taxRate,
      discount_percentage: line.discountPercentage,
      line_subtotal_cents: calculatedLine.subtotalCents,
      line_tax_cents: calculatedLine.taxCents,
      line_total_cents: calculatedLine.totalCents,
    };
  });
}

async function loadCompanyForDraft(
  database: Database,
  companyId: string,
  actor: string,
): Promise<CompanyForDraft> {
  const [company] = await database
    .select({
      id: companies.id,
      retentionRate: companies.retentionRate,
    })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.userId, actor)))
    .limit(1);

  if (!company) {
    throw new ResourceNotFoundError();
  }
  return company;
}

async function assertClientCanBeAssigned(
  database: Database,
  companyId: string,
  clientId: string | null | undefined,
): Promise<void> {
  if (!clientId) {
    return;
  }

  const [client] = await database
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, clientId),
        eq(clients.companyId, companyId),
        isNull(clients.archivedAt),
      ),
    )
    .limit(1);

  if (!client) {
    throw new ResourceNotFoundError();
  }
}

async function throwMutationFailure(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<never> {
  const [document] = await database
    .select({
      status: documents.status,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.companyId, companyId)),
    )
    .limit(1);

  if (!document || document.deletedAt) {
    throw new ResourceNotFoundError();
  }

  if (document.status === "draft") {
    throw new ApiError(
      "conflict",
      409,
      "Los datos relacionados han cambiado. Recarga el borrador e inténtalo de nuevo.",
    );
  }

  throw new ApiError(
    "conflict",
    409,
    document.status === "voided"
      ? "El documento anulado es inmutable."
      : "Solo puedes modificar documentos en borrador.",
  );
}

async function throwCreateFailure(
  database: Database,
  companyId: string,
  actor: string,
  clientId: string | null,
): Promise<never> {
  await loadCompanyForDraft(database, companyId, actor);
  await assertClientCanBeAssigned(database, companyId, clientId);

  throw new ApiError(
    "conflict",
    409,
    "Los datos relacionados han cambiado. Revisa el borrador e inténtalo de nuevo.",
  );
}

export async function getDocumentDetail<
  TDetail extends DocumentDetailProjection,
>({
  database = createDatabase(),
  companyId,
  documentId,
}: {
  database?: Database;
  companyId: string;
  documentId: string;
}): Promise<TDetail> {
  const rows = await database
    .select({
      document: documents,
      line: documentLines,
    })
    .from(documents)
    .leftJoin(documentLines, eq(documentLines.documentId, documents.id))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(asc(documentLines.position));

  const document = rows[0]?.document;
  if (!document) {
    throw new ResourceNotFoundError();
  }

  const lines = rows.flatMap((row) => (row.line ? [row.line] : []));

  return { ...document, lines } as unknown as TDetail;
}

export async function createDraftDocument(
  rawInput: CreateDraftDocumentInput,
  dependencies: DocumentServiceDependencies = {},
): Promise<DocumentDetail> {
  const input = validate(createDraftSchema, rawInput);
  const database = databaseFrom(dependencies);
  const now = dependencies.now ?? new Date();
  const company = await loadCompanyForDraft(
    database,
    input.companyId,
    input.actor,
  );
  await assertClientCanBeAssigned(database, input.companyId, input.clientId);

  const billing = calculateDraftBilling(input.lines, company.retentionRate);
  const documentId = createUuidV7(now.getTime());
  const eventId = createUuidV7(now.getTime());
  const preparedLines = prepareLines(input.lines, billing, now);
  const result = await database.execute<{ id: string }>(sql`
    WITH scoped_company AS MATERIALIZED (
      SELECT
        ${companies.id} AS id,
        ${companies.retentionRate} AS retention_rate
      FROM ${companies}
      WHERE ${companies.id} = ${input.companyId}
        AND ${companies.userId} = ${input.actor}
        AND ${companies.retentionRate} = ${company.retentionRate}::numeric
      FOR UPDATE
    ),
    scoped_client AS MATERIALIZED (
      SELECT assignable_client.id
      FROM ${clients} assignable_client
      JOIN scoped_company
        ON scoped_company.id = assignable_client.company_id
      WHERE assignable_client.id = ${input.clientId}
        AND assignable_client.archived_at IS NULL
      FOR SHARE OF assignable_client
    ),
    inserted_document AS (
      INSERT INTO ${documents} (
        ${sql.identifier(documents.id.name)},
        ${sql.identifier(documents.companyId.name)},
        ${sql.identifier(documents.documentType.name)},
        ${sql.identifier(documents.status.name)},
        ${sql.identifier(documents.clientId.name)},
        ${sql.identifier(documents.issueDate.name)},
        ${sql.identifier(documents.dueDate.name)},
        ${sql.identifier(documents.notes.name)},
        ${sql.identifier(documents.subtotalCents.name)},
        ${sql.identifier(documents.taxBreakdown.name)},
        ${sql.identifier(documents.retentionRate.name)},
        ${sql.identifier(documents.retentionCents.name)},
        ${sql.identifier(documents.totalCents.name)},
        ${sql.identifier(documents.createdAt.name)},
        ${sql.identifier(documents.updatedAt.name)}
      )
      SELECT
        ${documentId},
        scoped_company.id,
        ${input.documentType}::document_type,
        'draft'::document_status,
        ${input.clientId},
        ${input.issueDate},
        ${input.dueDate},
        ${input.notes},
        ${billing.subtotalCents},
        ${JSON.stringify(billing.taxBreakdown)}::jsonb,
        scoped_company.retention_rate,
        ${billing.retentionCents},
        ${billing.totalCents},
        ${now.toISOString()},
        ${now.toISOString()}
      FROM scoped_company
      LEFT JOIN scoped_client ON TRUE
      WHERE ${input.clientId === null}
        OR scoped_client.id IS NOT NULL
      RETURNING id, company_id
    ),
    line_input AS MATERIALIZED (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(preparedLines)}::jsonb) AS line (
        id uuid,
        position integer,
        description text,
        quantity numeric(12, 3),
        unit_price_cents integer,
        tax_rate numeric(5, 2),
        discount_percentage numeric(5, 2),
        line_subtotal_cents integer,
        line_tax_cents integer,
        line_total_cents integer
      )
    ),
    inserted_lines AS (
      INSERT INTO ${documentLines} (
        ${sql.identifier(documentLines.id.name)},
        ${sql.identifier(documentLines.documentId.name)},
        ${sql.identifier(documentLines.position.name)},
        ${sql.identifier(documentLines.description.name)},
        ${sql.identifier(documentLines.quantity.name)},
        ${sql.identifier(documentLines.unitPriceCents.name)},
        ${sql.identifier(documentLines.taxRate.name)},
        ${sql.identifier(documentLines.discountPercentage.name)},
        ${sql.identifier(documentLines.lineSubtotalCents.name)},
        ${sql.identifier(documentLines.lineTaxCents.name)},
        ${sql.identifier(documentLines.lineTotalCents.name)}
      )
      SELECT
        line_input.id,
        inserted_document.id,
        line_input.position,
        line_input.description,
        line_input.quantity,
        line_input.unit_price_cents,
        line_input.tax_rate,
        line_input.discount_percentage,
        line_input.line_subtotal_cents,
        line_input.line_tax_cents,
        line_input.line_total_cents
      FROM inserted_document
      CROSS JOIN line_input
      RETURNING id
    ),
    line_barrier AS (
      SELECT count(*) AS inserted_count
      FROM inserted_lines
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        ${sql.identifier(documentEvents.id.name)},
        ${sql.identifier(documentEvents.companyId.name)},
        ${sql.identifier(documentEvents.documentId.name)},
        ${sql.identifier(documentEvents.actor.name)},
        ${sql.identifier(documentEvents.event.name)},
        ${sql.identifier(documentEvents.createdAt.name)}
      )
      SELECT
        ${eventId},
        inserted_document.company_id,
        inserted_document.id,
        ${input.actor},
        'created'::document_event_type,
        ${now.toISOString()}
      FROM inserted_document
      CROSS JOIN line_barrier
      RETURNING document_id
    )
    SELECT inserted_document.id
    FROM inserted_document
    JOIN inserted_event
      ON inserted_event.document_id = inserted_document.id
  `);

  if (executionRows(result).length === 0) {
    return throwCreateFailure(
      database,
      input.companyId,
      input.actor,
      input.clientId,
    );
  }

  return getDocumentDetail<DocumentDetail>({
    database,
    companyId: input.companyId,
    documentId,
  });
}

export async function updateDraftDocument(
  rawInput: UpdateDraftDocumentInput,
  dependencies: DocumentServiceDependencies = {},
): Promise<DocumentDetail> {
  const input = validate(updateDraftSchema, rawInput);
  const database = databaseFrom(dependencies);
  const now = dependencies.now ?? new Date();
  const company = await loadCompanyForDraft(
    database,
    input.companyId,
    input.actor,
  );
  await assertClientCanBeAssigned(database, input.companyId, input.clientId);

  const replacesLines = input.lines !== undefined;
  const lines = input.lines ?? [];
  const billing = replacesLines
    ? calculateDraftBilling(lines, company.retentionRate)
    : emptyBilling();
  const preparedLines = replacesLines ? prepareLines(lines, billing, now) : [];
  const eventId = createUuidV7(now.getTime());
  const result = await database.execute<{ id: string }>(sql`
    WITH scoped_company AS MATERIALIZED (
      SELECT
        ${companies.id} AS id,
        ${companies.retentionRate} AS retention_rate
      FROM ${companies}
      WHERE ${companies.id} = ${input.companyId}
        AND ${companies.userId} = ${input.actor}
        AND (
          NOT ${replacesLines}
          OR ${companies.retentionRate} = ${company.retentionRate}::numeric
        )
      FOR UPDATE
    ),
    scoped_client AS MATERIALIZED (
      SELECT assignable_client.id
      FROM ${clients} assignable_client
      JOIN scoped_company
        ON scoped_company.id = assignable_client.company_id
      WHERE assignable_client.id = ${input.clientId ?? null}
        AND assignable_client.archived_at IS NULL
      FOR SHARE OF assignable_client
    ),
    target AS MATERIALIZED (
      SELECT
        target_document.id,
        scoped_company.retention_rate
      FROM ${documents} target_document
      JOIN scoped_company
        ON scoped_company.id = target_document.company_id
      WHERE target_document.id = ${input.documentId}
        AND target_document.status = 'draft'::document_status
        AND target_document.deleted_at IS NULL
        AND (
          NOT ${input.clientId !== undefined && input.clientId !== null}
          OR EXISTS (SELECT 1 FROM scoped_client)
        )
      FOR UPDATE OF target_document
    ),
    updated_document AS (
      UPDATE ${documents} target_document
      SET
        document_type = CASE
          WHEN ${input.documentType !== undefined}
            THEN ${input.documentType ?? "invoice"}::document_type
          ELSE target_document.document_type
        END,
        client_id = CASE
          WHEN ${input.clientId !== undefined} THEN ${input.clientId ?? null}
          ELSE target_document.client_id
        END,
        issue_date = CASE
          WHEN ${input.issueDate !== undefined} THEN ${input.issueDate ?? now.toISOString().slice(0, 10)}
          ELSE target_document.issue_date
        END,
        due_date = CASE
          WHEN ${input.dueDate !== undefined} THEN ${input.dueDate ?? null}
          ELSE target_document.due_date
        END,
        notes = CASE
          WHEN ${input.notes !== undefined} THEN ${input.notes ?? null}
          ELSE target_document.notes
        END,
        subtotal_cents = CASE
          WHEN ${replacesLines} THEN ${billing.subtotalCents}
          ELSE target_document.subtotal_cents
        END,
        tax_breakdown = CASE
          WHEN ${replacesLines} THEN ${JSON.stringify(billing.taxBreakdown)}::jsonb
          ELSE target_document.tax_breakdown
        END,
        retention_rate = CASE
          WHEN ${replacesLines} THEN target.retention_rate
          ELSE target_document.retention_rate
        END,
        retention_cents = CASE
          WHEN ${replacesLines} THEN ${billing.retentionCents}
          ELSE target_document.retention_cents
        END,
        total_cents = CASE
          WHEN ${replacesLines} THEN ${billing.totalCents}
          ELSE target_document.total_cents
        END,
        updated_at = ${now.toISOString()}
      FROM target
      WHERE target_document.id = target.id
      RETURNING target_document.id, target_document.company_id
    ),
    deleted_lines AS (
      DELETE FROM ${documentLines} current_line
      USING updated_document
      WHERE ${replacesLines}
        AND current_line.document_id = updated_document.id
      RETURNING current_line.id
    ),
    delete_barrier AS (
      SELECT count(*) AS deleted_count
      FROM deleted_lines
    ),
    line_input AS MATERIALIZED (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(preparedLines)}::jsonb) AS line (
        id uuid,
        position integer,
        description text,
        quantity numeric(12, 3),
        unit_price_cents integer,
        tax_rate numeric(5, 2),
        discount_percentage numeric(5, 2),
        line_subtotal_cents integer,
        line_tax_cents integer,
        line_total_cents integer
      )
    ),
    inserted_lines AS (
      INSERT INTO ${documentLines} (
        ${sql.identifier(documentLines.id.name)},
        ${sql.identifier(documentLines.documentId.name)},
        ${sql.identifier(documentLines.position.name)},
        ${sql.identifier(documentLines.description.name)},
        ${sql.identifier(documentLines.quantity.name)},
        ${sql.identifier(documentLines.unitPriceCents.name)},
        ${sql.identifier(documentLines.taxRate.name)},
        ${sql.identifier(documentLines.discountPercentage.name)},
        ${sql.identifier(documentLines.lineSubtotalCents.name)},
        ${sql.identifier(documentLines.lineTaxCents.name)},
        ${sql.identifier(documentLines.lineTotalCents.name)}
      )
      SELECT
        line_input.id,
        updated_document.id,
        line_input.position,
        line_input.description,
        line_input.quantity,
        line_input.unit_price_cents,
        line_input.tax_rate,
        line_input.discount_percentage,
        line_input.line_subtotal_cents,
        line_input.line_tax_cents,
        line_input.line_total_cents
      FROM updated_document
      CROSS JOIN delete_barrier
      CROSS JOIN line_input
      WHERE ${replacesLines}
      RETURNING id
    ),
    line_barrier AS (
      SELECT count(*) AS inserted_count
      FROM inserted_lines
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        ${sql.identifier(documentEvents.id.name)},
        ${sql.identifier(documentEvents.companyId.name)},
        ${sql.identifier(documentEvents.documentId.name)},
        ${sql.identifier(documentEvents.actor.name)},
        ${sql.identifier(documentEvents.event.name)},
        ${sql.identifier(documentEvents.createdAt.name)}
      )
      SELECT
        ${eventId},
        updated_document.company_id,
        updated_document.id,
        ${input.actor},
        'updated'::document_event_type,
        ${now.toISOString()}
      FROM updated_document
      CROSS JOIN line_barrier
      RETURNING document_id
    )
    SELECT updated_document.id
    FROM updated_document
    JOIN inserted_event
      ON inserted_event.document_id = updated_document.id
  `);

  if (executionRows(result).length === 0) {
    return throwMutationFailure(database, input.companyId, input.documentId);
  }

  return getDocumentDetail<DocumentDetail>({
    database,
    companyId: input.companyId,
    documentId: input.documentId,
  });
}

export async function softDeleteDraftDocument(
  rawInput: SoftDeleteDraftDocumentInput,
  dependencies: DocumentServiceDependencies = {},
): Promise<void> {
  const input = validate(deleteDraftSchema, rawInput);
  const database = databaseFrom(dependencies);
  const now = dependencies.now ?? new Date();
  await loadCompanyForDraft(database, input.companyId, input.actor);

  const result = await database.execute<{ id: string }>(sql`
    WITH scoped_company AS MATERIALIZED (
      SELECT ${companies.id} AS id
      FROM ${companies}
      WHERE ${companies.id} = ${input.companyId}
        AND ${companies.userId} = ${input.actor}
      FOR UPDATE
    ),
    deleted_document AS (
      UPDATE ${documents} target_document
      SET
        deleted_at = ${now.toISOString()},
        updated_at = ${now.toISOString()}
      FROM scoped_company
      WHERE target_document.id = ${input.documentId}
        AND target_document.company_id = scoped_company.id
        AND target_document.status = 'draft'::document_status
        AND target_document.deleted_at IS NULL
      RETURNING target_document.id, target_document.company_id
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        ${sql.identifier(documentEvents.id.name)},
        ${sql.identifier(documentEvents.companyId.name)},
        ${sql.identifier(documentEvents.documentId.name)},
        ${sql.identifier(documentEvents.actor.name)},
        ${sql.identifier(documentEvents.event.name)},
        ${sql.identifier(documentEvents.payload.name)},
        ${sql.identifier(documentEvents.createdAt.name)}
      )
      SELECT
        ${createUuidV7(now.getTime())},
        deleted_document.company_id,
        deleted_document.id,
        ${input.actor},
        'updated'::document_event_type,
        '{"operation":"draft_deleted"}'::jsonb,
        ${now.toISOString()}
      FROM deleted_document
      RETURNING document_id
    )
    SELECT deleted_document.id
    FROM deleted_document
    JOIN inserted_event
      ON inserted_event.document_id = deleted_document.id
  `);

  if (executionRows(result).length === 0) {
    return throwMutationFailure(database, input.companyId, input.documentId);
  }
}
