import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { documentSeries } from "@/db/schema/document-series";
import { ApiError } from "@/lib/api/errors";
import { type BillingResult, calculateBilling } from "@/lib/billing";
import {
  buildClientSnapshot,
  buildIssuerSnapshot,
  getCompanyReadiness,
  validateIssue,
} from "@/lib/documents";
import { createUuidV7 } from "@/lib/ids";
import { createCents } from "@/lib/money";
import {
  getMadridMonthBounds,
  getPlanCapabilities,
  type Plan,
} from "@/lib/plan";
import { ResourceNotFoundError } from "@/services/context";
import { createPdfRenderMessage } from "@/workers/messages";

const MAX_ISSUANCE_PREPARATION_ATTEMPTS = 3;

export type IssuanceLockResource = "company" | "document_series";

export interface PdfRenderQueue {
  send(message: unknown): Promise<void>;
}

/**
 * Closed descriptors keep the locked idempotency recheck inside the atomic SQL
 * statement. T114 and T115 can use these without accepting arbitrary SQL.
 */
export type IssuanceIdempotencyStrategy =
  | {
      kind: "converted_from";
      sourceDocumentId: string;
    }
  | {
      kind: "receipt_for_payment";
      paymentId: string;
    };

export interface IssueDocumentInput {
  companyId: string;
  documentId: string;
  actor: string;
  idempotency?: IssuanceIdempotencyStrategy;
}

export interface IssueDocumentDependencies {
  database?: Database;
  queue: PdfRenderQueue;
  now?: Date;
  onLockAcquired?(resource: IssuanceLockResource): void | Promise<void>;
}

export interface IssuedDocumentResult {
  id: string;
  documentType: "invoice" | "proforma" | "receipt";
  status: "issued" | "voided";
  seriesId: string;
  number: number;
  fullNumber: string;
  clientId: string;
  issueDate: string;
  dueDate: string | null;
  subtotalCents: number;
  taxBreakdown: unknown;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  issuerSnapshot: unknown;
  clientSnapshot: unknown;
  pdfStatus: "pending" | "ready" | "failed";
  issuedAt: Date;
}

interface IssuePreparation {
  company: {
    id: string;
    userId: string;
    legalName: string | null;
    taxId: string | null;
    address: string | null;
    email: string;
    phone: string | null;
    logoKey: string | null;
    defaultDueDays: number;
    retentionRate: string;
    plan: Plan;
  };
  document: {
    id: string;
    documentType: "invoice" | "proforma" | "receipt";
    status: "draft" | "issued" | "voided";
    clientId: string | null;
    issueDate: string;
    dueDate: string | null;
    deletedAt: Date | null;
    updatedAt: Date;
    /** Only read for receipts: pre-set by the receipt service and preserved
     * as-is rather than recalculated from (nonexistent) lines. */
    subtotalCents: number;
    taxBreakdown: unknown;
    retentionRate: string;
    retentionCents: number;
    totalCents: number;
  };
  client: {
    id: string;
    name: string;
    taxId: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    archivedAt: Date | null;
  } | null;
  lines: Array<{
    id: string;
    position: number;
    description: string;
    quantity: string;
    unitPriceCents: number;
    taxRate: string;
    discountPercentage: string;
  }>;
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

interface AtomicIssueRow extends Record<string, unknown> {
  outcome: "existing" | "issued" | "plan_limit";
  document_id: string | null;
  company_locked: boolean;
  series_locked: boolean;
}

async function executeIssuanceTransaction(
  database: Database,
  lockStatement: SQL,
  issueStatement: SQL,
): Promise<AtomicIssueRow | undefined> {
  if ("batch" in database && typeof database.batch === "function") {
    const [, issueResult] = await database.batch([
      database.execute(lockStatement),
      database.execute<AtomicIssueRow>(issueStatement),
    ]);
    return firstExecutionRow<AtomicIssueRow>(issueResult);
  }

  const transactionalDatabase = database as unknown as {
    transaction<T>(
      callback: (transaction: {
        execute(query: SQL): PromiseLike<unknown>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  if (typeof transactionalDatabase.transaction !== "function") {
    throw new Error(
      "La base de datos no admite la transacción de emisión requerida.",
    );
  }

  const issueResult = await transactionalDatabase.transaction(
    async (transaction) => {
      await transaction.execute(lockStatement);
      return transaction.execute(issueStatement);
    },
  );
  return firstExecutionRow<AtomicIssueRow>(issueResult);
}

function companyIncompleteError(
  missingFields: Array<"legalName" | "taxId" | "address">,
): ApiError {
  const messages = {
    legalName: "Indica el nombre o razón social de la empresa.",
    taxId: "Indica el NIF de la empresa.",
    address: "Indica la dirección fiscal de la empresa.",
  } as const;

  return new ApiError(
    "company_incomplete",
    400,
    "Completa los datos fiscales de la empresa antes de emitir.",
    Object.fromEntries(
      missingFields.map((field) => [`company.${field}`, messages[field]]),
    ),
  );
}

function issueValidationError(
  message: string,
  fields: Record<string, string>,
): ApiError {
  return new ApiError("validation_error", 400, message, fields);
}

function documentStateConflict(
  status: "draft" | "issued" | "voided",
): ApiError {
  return new ApiError(
    "conflict",
    409,
    status === "voided"
      ? "El documento está anulado y no puede volver a emitirse."
      : "Solo puedes emitir documentos en borrador.",
  );
}

function planLimitError(plan: Plan): ApiError {
  const limit = getPlanCapabilities(plan).docLimit;
  return new ApiError(
    "plan_limit_reached",
    402,
    `Has alcanzado el límite de ${limit} documentos emitidos este mes para tu plan.`,
  );
}

async function loadIssuePreparation(
  database: Database,
  input: IssueDocumentInput,
): Promise<IssuePreparation> {
  const rows = await database
    .select({
      company: {
        id: companies.id,
        userId: companies.userId,
        legalName: companies.legalName,
        taxId: companies.taxId,
        address: companies.address,
        email: companies.email,
        phone: companies.phone,
        logoKey: companies.logoKey,
        defaultDueDays: companies.defaultDueDays,
        retentionRate: companies.retentionRate,
        plan: companies.plan,
      },
      document: {
        id: documents.id,
        documentType: documents.documentType,
        status: documents.status,
        clientId: documents.clientId,
        issueDate: documents.issueDate,
        dueDate: documents.dueDate,
        deletedAt: documents.deletedAt,
        updatedAt: documents.updatedAt,
        subtotalCents: documents.subtotalCents,
        taxBreakdown: documents.taxBreakdown,
        retentionRate: documents.retentionRate,
        retentionCents: documents.retentionCents,
        totalCents: documents.totalCents,
      },
      client: {
        id: clients.id,
        name: clients.name,
        taxId: clients.taxId,
        address: clients.address,
        email: clients.email,
        phone: clients.phone,
        archivedAt: clients.archivedAt,
      },
      line: {
        id: documentLines.id,
        position: documentLines.position,
        description: documentLines.description,
        quantity: documentLines.quantity,
        unitPriceCents: documentLines.unitPriceCents,
        taxRate: documentLines.taxRate,
        discountPercentage: documentLines.discountPercentage,
      },
    })
    .from(companies)
    .innerJoin(
      documents,
      and(
        eq(documents.companyId, companies.id),
        eq(documents.id, input.documentId),
        isNull(documents.deletedAt),
      ),
    )
    .leftJoin(
      clients,
      and(
        eq(clients.id, documents.clientId),
        eq(clients.companyId, companies.id),
      ),
    )
    .leftJoin(documentLines, eq(documentLines.documentId, documents.id))
    .where(
      and(eq(companies.id, input.companyId), eq(companies.userId, input.actor)),
    )
    .orderBy(asc(documentLines.position));

  const first = rows[0];
  if (!first) {
    throw new ResourceNotFoundError();
  }

  return {
    company: first.company,
    document: first.document,
    client: first.client?.id ? first.client : null,
    lines: rows.flatMap((row) => (row.line?.id ? [row.line] : [])),
  };
}

function validatePreparation(preparation: IssuePreparation): void {
  if (preparation.document.status !== "draft") {
    throw documentStateConflict(preparation.document.status);
  }

  const readiness = getCompanyReadiness(preparation.company);
  if (!readiness.ready) {
    throw companyIncompleteError(readiness.missingFields);
  }

  if (preparation.document.documentType === "receipt") {
    // The receipt service (src/services/document-receipts.ts) already
    // resolved the client and totals from the source invoice/payment before
    // creating this draft; there are no lines to validate and archival of
    // the client afterwards must not block recording a historical receipt.
    return;
  }

  const validation = validateIssue({
    documentType: preparation.document.documentType,
    company: preparation.company,
    clientId: preparation.document.clientId,
    client: preparation.client,
    lines: preparation.lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceCents: line.unitPriceCents,
      taxRate: Number(line.taxRate),
      discountPct: Number(line.discountPercentage),
    })),
  });
  if (!validation.valid) {
    const messageByCode = {
      client_required: "Selecciona un cliente activo de tu empresa.",
      client_tax_id_required:
        "Añade el NIF del cliente para poder emitir la factura.",
      client_address_required:
        "Añade la dirección del cliente para poder emitir la factura.",
      description_required: "La descripción no puede estar vacía.",
      discount_pct_out_of_range: "El descuento debe estar entre 0 y 100.",
      issuer_address_required: "Indica la dirección fiscal de la empresa.",
      issuer_legal_name_required:
        "Indica el nombre o razón social de la empresa.",
      issuer_tax_id_required: "Indica el NIF de la empresa.",
      lines_required: "El documento debe incluir al menos una línea.",
      quantity_must_be_positive: "La cantidad debe ser mayor que cero.",
      tax_rate_out_of_range: "El tipo impositivo debe estar entre 0 y 99,99.",
      unit_price_cents_must_be_non_negative_integer:
        "El precio debe ser un entero no negativo en céntimos.",
    } as const;
    throw issueValidationError(
      "Revisa los datos del cliente y las líneas antes de emitir.",
      Object.fromEntries(
        validation.errors.map((error) => [
          error.field,
          messageByCode[error.code],
        ]),
      ),
    );
  }
  if (!preparation.client) {
    throw issueValidationError(
      "Selecciona un cliente activo antes de emitir.",
      {
        clientId: "Selecciona un cliente activo de tu empresa.",
      },
    );
  }
  if (preparation.client.archivedAt) {
    throw issueValidationError(
      "El cliente está archivado. Restáuralo o selecciona otro cliente.",
      { clientId: "El cliente seleccionado está archivado." },
    );
  }
}

function calculateIssueBilling(preparation: IssuePreparation): {
  billing: BillingResult;
  preparedLines: PreparedLine[];
} {
  if (preparation.document.documentType === "receipt") {
    // Preserve the totals the receipt service already stored (exact payment
    // amount, zero fiscal base/tax/retention) instead of recalculating from
    // lines, since receipts never have any.
    return {
      billing: {
        lines: [],
        taxBreakdown: (preparation.document.taxBreakdown ??
          []) as BillingResult["taxBreakdown"],
        subtotalCents: createCents(preparation.document.subtotalCents),
        retentionCents: createCents(preparation.document.retentionCents),
        totalCents: createCents(preparation.document.totalCents),
      },
      preparedLines: [],
    };
  }

  try {
    const billing = calculateBilling({
      lines: preparation.lines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: createCents(line.unitPriceCents),
        taxRate: line.taxRate,
        discountPercentage: line.discountPercentage,
      })),
      retentionRate: preparation.company.retentionRate,
    });
    return {
      billing,
      preparedLines: preparation.lines.map((line, index) => {
        const calculated = billing.lines[index];
        if (!calculated) {
          throw new Error("No se ha podido calcular una línea del documento.");
        }
        return {
          id: line.id,
          position: line.position,
          description: line.description,
          quantity: line.quantity,
          unit_price_cents: line.unitPriceCents,
          tax_rate: line.taxRate,
          discount_percentage: line.discountPercentage,
          line_subtotal_cents: calculated.subtotalCents,
          line_tax_cents: calculated.taxCents,
          line_total_cents: calculated.totalCents,
        };
      }),
    };
  } catch (error) {
    throw issueValidationError(
      "Revisa las líneas del documento antes de emitir.",
      {
        lines:
          error instanceof Error
            ? error.message
            : "Las líneas del documento no son válidas.",
      },
    );
  }
}

async function loadIssuedDocument(
  database: Database,
  companyId: string,
  documentId: string,
): Promise<IssuedDocumentResult> {
  const [document] = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      status: documents.status,
      seriesId: documents.seriesId,
      number: documents.number,
      fullNumber: documents.fullNumber,
      clientId: documents.clientId,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      subtotalCents: documents.subtotalCents,
      taxBreakdown: documents.taxBreakdown,
      retentionRate: documents.retentionRate,
      retentionCents: documents.retentionCents,
      totalCents: documents.totalCents,
      issuerSnapshot: documents.issuerSnapshot,
      clientSnapshot: documents.clientSnapshot,
      pdfStatus: documents.pdfStatus,
      issuedAt: documents.issuedAt,
    })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.companyId, companyId)),
    )
    .limit(1);

  if (
    !document ||
    (document.status !== "issued" && document.status !== "voided") ||
    !document.seriesId ||
    document.number === null ||
    !document.fullNumber ||
    !document.clientId ||
    !document.pdfStatus ||
    !document.issuedAt
  ) {
    throw new ResourceNotFoundError();
  }

  return document as IssuedDocumentResult;
}

async function resolveExistingIdempotentDocument(
  database: Database,
  input: IssueDocumentInput,
): Promise<IssuedDocumentResult | null> {
  if (!input.idempotency) {
    return null;
  }

  const idempotency = input.idempotency;
  const [existing] = await database
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(
      companies,
      and(
        eq(companies.id, documents.companyId),
        eq(companies.userId, input.actor),
      ),
    )
    .where(
      and(
        eq(documents.companyId, input.companyId),
        sql`${documents.status} IN ('issued'::document_status, 'voided'::document_status)`,
        idempotency.kind === "converted_from"
          ? and(
              eq(documents.documentType, "invoice"),
              eq(documents.convertedFromId, idempotency.sourceDocumentId),
            )
          : and(
              eq(documents.documentType, "receipt"),
              eq(documents.paymentId, idempotency.paymentId),
            ),
      ),
    )
    .limit(1);

  return existing
    ? loadIssuedDocument(database, input.companyId, existing.id)
    : null;
}

function prepareSnapshots(preparation: IssuePreparation): {
  issuerSnapshot: ReturnType<typeof buildIssuerSnapshot>;
  clientSnapshot: ReturnType<typeof buildClientSnapshot>;
} {
  const { company, client } = preparation;
  if (!company.legalName || !company.taxId || !company.address || !client) {
    throw new Error("La preparación validada no contiene snapshots completos.");
  }

  return {
    issuerSnapshot: buildIssuerSnapshot({
      legalName: company.legalName,
      taxId: company.taxId,
      address: company.address,
      email: company.email,
      phone: company.phone,
      logoKey: company.logoKey,
    }),
    clientSnapshot: buildClientSnapshot({
      name: client.name,
      taxId: client.taxId,
      address: client.address,
      email: client.email,
      phone: client.phone,
    }),
  };
}

async function executeAtomicIssue(
  database: Database,
  input: IssueDocumentInput,
  preparation: IssuePreparation,
  now: Date,
): Promise<AtomicIssueRow | undefined> {
  const { billing, preparedLines } = calculateIssueBilling(preparation);
  const { issuerSnapshot, clientSnapshot } = prepareSnapshots(preparation);
  const { start, endExclusive } = getMadridMonthBounds(now);
  const nowIso = now.toISOString();
  const preparedDocumentUpdatedAtIso =
    preparation.document.updatedAt.toISOString();
  const freeLimit = getPlanCapabilities("free").docLimit;
  const proLimit = getPlanCapabilities("pro").docLimit;
  const eventId = createUuidV7(now.getTime());
  const idempotencyKind = input.idempotency?.kind ?? null;
  const idempotencyReference =
    input.idempotency?.kind === "converted_from"
      ? input.idempotency.sourceDocumentId
      : input.idempotency?.kind === "receipt_for_payment"
        ? input.idempotency.paymentId
        : null;

  const lockStatement = sql`
    SELECT issuer.id
    FROM ${companies} issuer
    WHERE issuer.id = ${input.companyId}
      AND issuer.user_id = ${input.actor}
    FOR UPDATE
  `;
  const issueStatement = sql`
    WITH locked_company AS MATERIALIZED (
      SELECT
        issuer.id,
        issuer.legal_name,
        issuer.tax_id,
        issuer.address,
        issuer.email,
        issuer.phone,
        issuer.logo_key,
        issuer.default_due_days,
        issuer.retention_rate,
        issuer.plan
      FROM ${companies} issuer
      WHERE issuer.id = ${input.companyId}
        AND issuer.user_id = ${input.actor}
      FOR UPDATE
    ),
    idempotent_result AS MATERIALIZED (
      SELECT existing_document.id AS document_id
      FROM ${documents} existing_document
      JOIN locked_company
        ON locked_company.id = existing_document.company_id
      WHERE existing_document.status IN (
          'issued'::document_status,
          'voided'::document_status
        )
        AND (
          (
            ${idempotencyKind}::text = 'converted_from'
            AND existing_document.document_type = 'invoice'::document_type
            AND existing_document.converted_from_id =
              ${idempotencyReference}::uuid
          )
          OR (
            ${idempotencyKind}::text = 'receipt_for_payment'
            AND existing_document.document_type = 'receipt'::document_type
            AND existing_document.payment_id = ${idempotencyReference}::uuid
          )
        )
      LIMIT 1
    ),
    monthly_usage AS MATERIALIZED (
      SELECT count(issued_document.id)::integer AS issued_count
      FROM locked_company
      LEFT JOIN ${documents} issued_document
        ON issued_document.company_id = locked_company.id
        AND issued_document.status IN (
          'issued'::document_status,
          'voided'::document_status
        )
        AND issued_document.issued_at >= ${start.toISOString()}
        AND issued_document.issued_at < ${endExclusive.toISOString()}
      WHERE NOT EXISTS (SELECT 1 FROM idempotent_result)
    ),
    quota_slot AS MATERIALIZED (
      SELECT locked_company.*
      FROM locked_company
      CROSS JOIN monthly_usage
      WHERE NOT EXISTS (SELECT 1 FROM idempotent_result)
        AND monthly_usage.issued_count < CASE locked_company.plan
          WHEN 'free'::plan THEN ${freeLimit}::integer
          WHEN 'pro'::plan THEN ${proLimit}::integer
        END
    ),
    target_document AS MATERIALIZED (
      SELECT
        target.id,
        target.document_type,
        target.client_id,
        target.issue_date,
        target.due_date
      FROM ${documents} target
      JOIN quota_slot
        ON quota_slot.id = target.company_id
      WHERE target.id = ${input.documentId}
        AND target.status = 'draft'::document_status
        AND target.deleted_at IS NULL
        AND target.updated_at = ${preparedDocumentUpdatedAtIso}
        AND target.document_type =
          ${preparation.document.documentType}::document_type
        AND target.client_id = ${preparation.document.clientId}::uuid
      FOR UPDATE OF target
    ),
    active_client AS MATERIALIZED (
      SELECT customer.*
      FROM ${clients} customer
      JOIN target_document
        ON target_document.client_id = customer.id
      JOIN quota_slot
        ON quota_slot.id = customer.company_id
      WHERE customer.archived_at IS NULL
        AND customer.name = ${preparation.client?.name ?? null}
        AND customer.tax_id IS NOT DISTINCT FROM
          ${preparation.client?.taxId ?? null}
        AND customer.address IS NOT DISTINCT FROM
          ${preparation.client?.address ?? null}
        AND customer.email IS NOT DISTINCT FROM
          ${preparation.client?.email ?? null}
        AND customer.phone IS NOT DISTINCT FROM
          ${preparation.client?.phone ?? null}
      FOR SHARE OF customer
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
    validated_target AS MATERIALIZED (
      SELECT target_document.*
      FROM target_document
      CROSS JOIN quota_slot
      WHERE btrim(coalesce(quota_slot.legal_name, '')) <> ''
        AND btrim(coalesce(quota_slot.tax_id, '')) <> ''
        AND btrim(coalesce(quota_slot.address, '')) <> ''
        AND quota_slot.legal_name = ${preparation.company.legalName}
        AND quota_slot.tax_id = ${preparation.company.taxId}
        AND quota_slot.address = ${preparation.company.address}
        AND quota_slot.email = ${preparation.company.email}
        AND quota_slot.phone IS NOT DISTINCT FROM ${preparation.company.phone}
        AND quota_slot.logo_key IS NOT DISTINCT FROM
          ${preparation.company.logoKey}
        AND quota_slot.retention_rate =
          ${preparation.company.retentionRate}::numeric
        AND (
          target_document.document_type = 'receipt'::document_type
          OR EXISTS (SELECT 1 FROM active_client)
        )
        AND (
          target_document.document_type = 'receipt'::document_type
          OR (SELECT count(*) FROM line_input) > 0
        )
        AND (
          SELECT count(*)
          FROM ${documentLines} current_line
          WHERE current_line.document_id = target_document.id
        ) = (SELECT count(*) FROM line_input)
        AND NOT EXISTS (
          SELECT 1
          FROM ${documentLines} current_line
          LEFT JOIN line_input
            ON line_input.id = current_line.id
          WHERE current_line.document_id = target_document.id
            AND (
              line_input.id IS NULL
              OR current_line.position IS DISTINCT FROM line_input.position
              OR current_line.description IS DISTINCT FROM
                line_input.description
              OR current_line.quantity IS DISTINCT FROM line_input.quantity
              OR current_line.unit_price_cents IS DISTINCT FROM
                line_input.unit_price_cents
              OR current_line.tax_rate IS DISTINCT FROM line_input.tax_rate
              OR current_line.discount_pct IS DISTINCT FROM
                line_input.discount_percentage
            )
        )
    ),
    locked_series AS MATERIALIZED (
      SELECT numbering_series.*
      FROM ${documentSeries} numbering_series
      JOIN validated_target
        ON validated_target.document_type = numbering_series.document_type
      JOIN quota_slot
        ON quota_slot.id = numbering_series.company_id
      WHERE numbering_series.is_default
        AND numbering_series.next_number < 2147483647
      FOR UPDATE OF numbering_series
    ),
    advanced_series AS (
      UPDATE ${documentSeries} numbering_series
      SET next_number = locked_series.next_number + 1
      FROM locked_series
      WHERE numbering_series.id = locked_series.id
      RETURNING
        numbering_series.id,
        locked_series.prefix,
        locked_series.next_number AS allocated_number
    ),
    issued_document AS (
      UPDATE ${documents} target
      SET
        status = 'issued'::document_status,
        series_id = advanced_series.id,
        number = advanced_series.allocated_number,
        full_number =
          advanced_series.prefix ||
          lpad(advanced_series.allocated_number::text, 4, '0'),
        due_date = CASE
          WHEN target.document_type = 'invoice'::document_type
            AND target.due_date IS NULL
          THEN target.issue_date + quota_slot.default_due_days
          ELSE target.due_date
        END,
        subtotal_cents = ${billing.subtotalCents},
        tax_breakdown = ${JSON.stringify(billing.taxBreakdown)}::jsonb,
        retention_rate = CASE
          WHEN target.document_type = 'receipt'::document_type THEN '0.00'::numeric
          ELSE quota_slot.retention_rate
        END,
        retention_cents = ${billing.retentionCents},
        total_cents = ${billing.totalCents},
        issuer_snapshot = ${JSON.stringify(issuerSnapshot)}::jsonb,
        client_snapshot = ${JSON.stringify(clientSnapshot)}::jsonb,
        pdf_status = 'pending'::pdf_status,
        pdf_ready_at = NULL,
        issued_at = ${nowIso},
        updated_at = ${nowIso}
      FROM validated_target, quota_slot, advanced_series
      WHERE target.id = validated_target.id
      RETURNING target.id, target.company_id
    ),
    updated_lines AS (
      UPDATE ${documentLines} persisted_line
      SET
        line_subtotal_cents = line_input.line_subtotal_cents,
        line_tax_cents = line_input.line_tax_cents,
        line_total_cents = line_input.line_total_cents
      FROM line_input, issued_document
      WHERE persisted_line.id = line_input.id
        AND persisted_line.document_id = issued_document.id
      RETURNING persisted_line.id
    ),
    line_barrier AS MATERIALIZED (
      SELECT count(*) AS updated_count
      FROM updated_lines
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
        issued_document.company_id,
        issued_document.id,
        ${input.actor},
        'issued'::document_event_type,
        ${nowIso}
      FROM issued_document
      CROSS JOIN line_barrier
      WHERE line_barrier.updated_count = ${preparedLines.length}
      RETURNING document_id
    )
    SELECT
      'existing'::text AS outcome,
      idempotent_result.document_id,
      TRUE AS company_locked,
      FALSE AS series_locked
    FROM idempotent_result
    UNION ALL
    SELECT
      'issued'::text AS outcome,
      issued_document.id AS document_id,
      TRUE AS company_locked,
      TRUE AS series_locked
    FROM issued_document
    JOIN inserted_event
      ON inserted_event.document_id = issued_document.id
    UNION ALL
    SELECT
      'plan_limit'::text AS outcome,
      NULL::uuid AS document_id,
      TRUE AS company_locked,
      FALSE AS series_locked
    FROM locked_company
    WHERE NOT EXISTS (SELECT 1 FROM idempotent_result)
      AND NOT EXISTS (SELECT 1 FROM quota_slot)
  `;

  return executeIssuanceTransaction(database, lockStatement, issueStatement);
}

async function throwAtomicIssueFailure(
  database: Database,
  input: IssueDocumentInput,
): Promise<never> {
  const preparation = await loadIssuePreparation(database, input);
  validatePreparation(preparation);

  const [defaultSeries] = await database
    .select({
      id: documentSeries.id,
      nextNumber: documentSeries.nextNumber,
    })
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, input.companyId),
        eq(documentSeries.documentType, preparation.document.documentType),
        eq(documentSeries.isDefault, true),
      ),
    )
    .limit(1);

  if (!defaultSeries) {
    throw issueValidationError(
      "Configura una serie predeterminada antes de emitir.",
      {
        seriesId: `Falta una serie predeterminada para ${preparation.document.documentType}.`,
      },
    );
  }
  if (defaultSeries.nextNumber >= 2_147_483_647) {
    throw new ApiError(
      "conflict",
      409,
      "La serie ha agotado su numeración. Crea una serie nueva para continuar.",
    );
  }

  throw new ApiError(
    "conflict",
    409,
    "El borrador ha cambiado durante la emisión. Recárgalo e inténtalo de nuevo.",
  );
}

/**
 * Shared issuance guard. Every successful database effect is performed by one
 * SQL statement because neon-http does not support transaction callbacks.
 */
export async function issueDocument(
  input: IssueDocumentInput,
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? new Date();

  for (
    let attempt = 0;
    attempt < MAX_ISSUANCE_PREPARATION_ATTEMPTS;
    attempt += 1
  ) {
    const preparation = await loadIssuePreparation(database, input);

    // A concurrent call sharing the same idempotency key (converting the
    // same proforma, or receipting the same payment) may have issued this
    // exact document between our previous attempt and this one; resolving it
    // here — before the hard "must be draft" gate — keeps every racer
    // converging on that single result instead of failing with a conflict.
    if (preparation.document.status !== "draft") {
      const existing = await resolveExistingIdempotentDocument(database, input);
      if (existing) {
        return existing;
      }
    }

    validatePreparation(preparation);
    const row = await executeAtomicIssue(database, input, preparation, now);

    if (row?.company_locked) {
      await dependencies.onLockAcquired?.("company");
    }
    if (row?.series_locked) {
      await dependencies.onLockAcquired?.("document_series");
    }

    if (row?.outcome === "existing" && row.document_id) {
      return loadIssuedDocument(database, input.companyId, row.document_id);
    }
    if (row?.outcome === "plan_limit") {
      throw planLimitError(preparation.company.plan);
    }
    if (row?.outcome === "issued" && row.document_id) {
      await dependencies.queue.send(createPdfRenderMessage(row.document_id));
      return loadIssuedDocument(database, input.companyId, row.document_id);
    }

    if (attempt === MAX_ISSUANCE_PREPARATION_ATTEMPTS - 1) {
      return throwAtomicIssueFailure(database, input);
    }
  }

  throw new Error("No se ha podido completar la emisión.");
}
