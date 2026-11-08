import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { documentLinks } from "@/db/schema/document-link";
import { ApiError } from "@/lib/api/errors";
import { calculateBilling } from "@/lib/billing";
import { groupDeliveryNoteLines } from "@/lib/documents/conversion";
import { createUuidV7, deterministicUuid } from "@/lib/ids";
import { createCents } from "@/lib/money";
import { madridDate } from "@/lib/plan";
import { ResourceNotFoundError } from "@/services/context";
import {
  type IssueDocumentDependencies,
  type IssuedDocumentResult,
  issueDocument,
  loadIssuedDocument,
} from "@/services/document-issuance";
import { liveInvoicing } from "@/services/document-links";

export interface InvoiceDeliveryNotesInput {
  database?: Database;
  companyId: string;
  actor: string;
  deliveryNoteIds: string[];
  /** Required by the route: the same request always yields one invoice. */
  idempotencyKey: string;
  now?: Date;
}

function alreadyInvoicedError(invoice: {
  invoiceId: string;
  invoiceNumber: string | null;
}): ApiError {
  return new ApiError(
    "delivery_note_already_invoiced",
    409,
    invoice.invoiceNumber
      ? `Este albarán ya está facturado en la factura ${invoice.invoiceNumber}.`
      : "Este albarán ya está incluido en un borrador de factura.",
    undefined,
    {
      invoice_id: invoice.invoiceId,
      invoice_number: invoice.invoiceNumber,
    },
  );
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
 * One invoice draft from several delivery notes of the same client (US9,
 * FR-037): lines copied by value and grouped per note with `section_label`.
 * The document, its lines, one `invoiced` link per note and the events are
 * written in a single statement; the partial unique index on live
 * `invoiced` links makes a concurrent attempt fail atomically.
 */
export async function invoiceDeliveryNotes(
  input: InvoiceDeliveryNotesInput,
): Promise<{ id: string }> {
  const database = input.database ?? createDatabase();
  const now = input.now ?? new Date();
  const noteIds = [...new Set(input.deliveryNoteIds)].sort();
  const invoiceId = await deterministicUuid(
    input.companyId,
    "invoice-delivery-notes",
    noteIds.join(","),
    input.idempotencyKey,
  );

  const [existing] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, invoiceId),
        eq(documents.companyId, input.companyId),
      ),
    );
  if (existing) {
    return { id: existing.id };
  }

  const notes = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      status: documents.status,
      clientId: documents.clientId,
      fullNumber: documents.fullNumber,
      issueDate: documents.issueDate,
      collectionMethodId: documents.collectionMethodId,
    })
    .from(documents)
    .where(
      and(
        inArray(documents.id, noteIds),
        eq(documents.companyId, input.companyId),
        isNull(documents.deletedAt),
      ),
    );
  if (notes.length !== noteIds.length) {
    throw new ResourceNotFoundError();
  }
  if (
    notes.some(
      (note) =>
        note.documentType !== "delivery_note" || note.status !== "issued",
    )
  ) {
    throw new ApiError(
      "conversion_not_allowed",
      409,
      "Solo puedes facturar albaranes emitidos y no anulados.",
    );
  }
  const clientIds = new Set(notes.map((note) => note.clientId));
  if (clientIds.size !== 1 || notes[0]?.clientId === null) {
    throw new ApiError(
      "validation_error",
      400,
      "Los albaranes de una factura deben ser del mismo cliente.",
      { delivery_note_ids: "Elige albaranes del mismo cliente." },
    );
  }
  const invoiced = await liveInvoicing(database, noteIds);
  if (invoiced[0]) {
    throw alreadyInvoicedError(invoiced[0]);
  }

  const lines = await database
    .select()
    .from(documentLines)
    .where(inArray(documentLines.documentId, noteIds))
    .orderBy(asc(documentLines.position));
  const grouped = groupDeliveryNoteLines(
    notes.map((note) => ({
      fullNumber: note.fullNumber ?? note.id,
      issueDate: note.issueDate,
      lines: lines
        .filter((line) => line.documentId === note.id)
        .map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          taxRate: line.taxRate,
          taxName: line.taxName,
          discountPercentage: line.discountPercentage,
          unit: line.unit,
          taxRateId: line.taxRateId,
          catalogItemId: line.catalogItemId,
        })),
    })),
  );
  if (grouped.length === 0) {
    throw new ApiError(
      "validation_error",
      400,
      "Los albaranes elegidos no tienen líneas que facturar.",
    );
  }

  const [company] = await database
    .select({ retentionRate: companies.retentionRate })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  const billing = calculateBilling({
    lines: grouped.map((line) => ({
      quantity: line.quantity,
      unitPriceCents: createCents(line.unitPriceCents),
      taxRate: line.taxRate,
      taxName: line.taxName,
      discountPercentage: line.discountPercentage,
    })),
    retentionRate: company?.retentionRate ?? "0",
  });
  const lineRows = grouped.map((line, index) => ({
    id: createUuidV7(now.getTime()),
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit_price_cents: line.unitPriceCents,
    tax_rate: line.taxRate,
    tax_name: line.taxName ?? "IVA",
    discount_pct: line.discountPercentage,
    unit: line.unit ?? null,
    tax_rate_id: line.taxRateId ?? null,
    catalog_item_id: line.catalogItemId ?? null,
    section_label: line.sectionLabel,
    line_subtotal_cents: billing.lines[index]?.subtotalCents ?? 0,
    line_tax_cents: billing.lines[index]?.taxCents ?? 0,
    line_total_cents: billing.lines[index]?.totalCents ?? 0,
  }));
  const linkRows = notes.map((note) => ({
    id: createUuidV7(now.getTime()),
    source_document_id: note.id,
  }));
  const nowIso = now.toISOString();
  const first = notes[0];

  try {
    await database.execute(sql`
      WITH inserted_invoice AS (
        INSERT INTO ${documents} (
          id, company_id, document_type, status, client_id,
          collection_method_id, issue_date, subtotal_cents, tax_breakdown,
          retention_rate, retention_cents, total_cents, created_at, updated_at
        )
        VALUES (
          ${invoiceId}::uuid, ${input.companyId}::uuid, 'invoice'::document_type,
          'draft'::document_status, ${first?.clientId ?? null}::uuid,
          ${first?.collectionMethodId ?? null}::uuid, ${madridDate(now)}::date,
          ${billing.subtotalCents}::integer,
          ${JSON.stringify(billing.taxBreakdown)}::jsonb,
          ${company?.retentionRate ?? "0"}::numeric,
          ${billing.retentionCents}::integer, ${billing.totalCents}::integer,
          ${nowIso}, ${nowIso}
        )
        RETURNING id, company_id
      ),
      inserted_lines AS (
        INSERT INTO ${documentLines} (
          id, document_id, position, description, quantity, unit_price_cents,
          tax_rate, tax_name, discount_pct, unit, tax_rate_id, catalog_item_id,
          section_label, line_subtotal_cents, line_tax_cents, line_total_cents
        )
        SELECT line.id, inserted_invoice.id, line.position, line.description,
          line.quantity, line.unit_price_cents, line.tax_rate, line.tax_name,
          line.discount_pct, line.unit, line.tax_rate_id, line.catalog_item_id,
          line.section_label, line.line_subtotal_cents, line.line_tax_cents,
          line.line_total_cents
        FROM inserted_invoice
        CROSS JOIN jsonb_to_recordset(${JSON.stringify(lineRows)}::jsonb) AS line(
          id uuid, position integer, description text, quantity numeric,
          unit_price_cents integer, tax_rate numeric, tax_name text,
          discount_pct numeric, unit text, tax_rate_id uuid,
          catalog_item_id uuid, section_label text, line_subtotal_cents integer,
          line_tax_cents integer, line_total_cents integer
        )
        RETURNING id
      ),
      inserted_links AS (
        INSERT INTO ${documentLinks} (
          id, company_id, source_document_id, target_document_id, kind, created_at
        )
        SELECT link.id, inserted_invoice.company_id, link.source_document_id,
          inserted_invoice.id, 'invoiced'::document_link_kind, ${nowIso}
        FROM inserted_invoice
        CROSS JOIN jsonb_to_recordset(${JSON.stringify(linkRows)}::jsonb) AS link(
          id uuid, source_document_id uuid
        )
        RETURNING source_document_id
      ),
      created_event AS (
        INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
        SELECT ${createUuidV7(now.getTime())}, inserted_invoice.company_id,
          inserted_invoice.id, ${input.actor}, 'created'::document_event_type,
          jsonb_build_object('delivery_note_ids', ${JSON.stringify(noteIds)}::jsonb),
          ${nowIso}
        FROM inserted_invoice
        CROSS JOIN (SELECT count(*) FROM inserted_lines) AS line_barrier
        RETURNING document_id
      ),
      linked_events AS (
        INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, payload, created_at)
        SELECT gen_random_uuid(), ${input.companyId}::uuid,
          inserted_links.source_document_id, ${input.actor},
          'linked'::document_event_type,
          jsonb_build_object('invoice_id', ${invoiceId}::text, 'kind', 'invoiced'),
          ${nowIso}
        FROM inserted_links
        RETURNING document_id
      )
      SELECT (SELECT count(*) FROM created_event) AS created,
        (SELECT count(*) FROM linked_events) AS linked
    `);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Either the same request won the race (same id) or another invoice
    // took one of the notes first.
    const [raced] = await database
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, invoiceId));
    if (raced) {
      return { id: raced.id };
    }
    const taken = await liveInvoicing(database, noteIds);
    if (taken[0]) {
      throw alreadyInvoicedError(taken[0]);
    }
    throw error;
  }
  return { id: invoiceId };
}

/** `issue: true`: the new invoice goes through the common issuance guard. */
export async function invoiceDeliveryNotesAndIssue(
  input: InvoiceDeliveryNotesInput,
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  const database = dependencies.database ?? input.database ?? createDatabase();
  const now = dependencies.now ?? input.now ?? new Date();
  const { id } = await invoiceDeliveryNotes({ ...input, database, now });
  const [current] = await database
    .select({ status: documents.status })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, input.companyId)));
  if (current && current.status !== "draft") {
    // Redelivered request: the invoice was already issued.
    return loadIssuedDocument(database, input.companyId, id);
  }
  return issueDocument(
    { companyId: input.companyId, documentId: id, actor: input.actor },
    { ...dependencies, database, now },
  );
}
