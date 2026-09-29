import { and, eq, isNull, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { firstExecutionRow } from "@/db/result";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { payments } from "@/db/schema/payment";
import { ApiError } from "@/lib/api/errors";
import {
  buildReceiptTotals,
  validateReceiptSource,
} from "@/lib/documents/receipts";
import { createUuidV7 } from "@/lib/ids";
import { ResourceNotFoundError } from "@/services/context";
import {
  type IssueDocumentDependencies,
  type IssuedDocumentResult,
  issueDocument,
} from "@/services/document-issuance";
import { ensureDefaultSeries } from "@/services/series";

function receiptConflictError(
  error: "not_an_invoice" | "not_issued" | "payment_mismatch",
): ApiError {
  const messages = {
    not_an_invoice: "Solo puedes generar recibos de facturas.",
    not_issued: "Solo puedes generar recibos de facturas emitidas.",
    payment_mismatch: "El pago no pertenece a esta factura.",
  } as const;
  return new ApiError("conflict", 409, messages[error]);
}

interface InvoiceRow {
  id: string;
  documentType: "invoice" | "proforma" | "receipt";
  status: "draft" | "issued" | "voided";
  clientId: string | null;
}

interface PaymentRow {
  id: string;
  documentId: string;
  amountCents: number;
}

async function loadInvoice(
  database: Database,
  companyId: string,
  invoiceId: string,
): Promise<InvoiceRow> {
  const [invoice] = await database
    .select({
      id: documents.id,
      documentType: documents.documentType,
      status: documents.status,
      clientId: documents.clientId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, invoiceId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw new ResourceNotFoundError();
  }
  return invoice;
}

async function loadPayment(
  database: Database,
  companyId: string,
  paymentId: string,
): Promise<PaymentRow> {
  const [payment] = await database
    .select({
      id: payments.id,
      documentId: payments.documentId,
      amountCents: payments.amountCents,
    })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
    .limit(1);

  if (!payment) {
    throw new ResourceNotFoundError();
  }
  return payment;
}

interface ReceiptRow extends Record<string, unknown> {
  receipt_id: string;
}

/**
 * Resolves the payment's existing receipt or inserts a brand-new draft row
 * for it; the `document_payment_receipt_unique` partial index is the hard
 * backstop against a concurrent double-insert for the same payment.
 */
async function resolveOrCreateDraftReceipt(
  database: Database,
  companyId: string,
  actor: string,
  invoice: InvoiceRow,
  payment: PaymentRow,
  now: Date,
): Promise<string> {
  const newReceiptId = createUuidV7(now.getTime());
  const eventId = createUuidV7(now.getTime());
  const nowIso = now.toISOString();
  const totals = buildReceiptTotals(payment.amountCents);

  const result = await database.execute<ReceiptRow>(sql`
    WITH existing_receipt AS MATERIALIZED (
      SELECT id
      FROM ${documents}
      WHERE payment_id = ${payment.id}
        AND document_type = 'receipt'::document_type
      LIMIT 1
    ),
    inserted_receipt AS (
      INSERT INTO ${documents} (
        id, company_id, document_type, status, client_id, invoice_id,
        payment_id, issue_date, subtotal_cents, tax_breakdown, retention_rate,
        retention_cents, total_cents, created_at, updated_at
      )
      SELECT
        ${newReceiptId}, ${companyId}, 'receipt'::document_type,
        'draft'::document_status, ${invoice.clientId}, ${invoice.id},
        ${payment.id}, ${nowIso}::date, ${totals.subtotalCents},
        ${JSON.stringify(totals.taxBreakdown)}::jsonb, ${totals.retentionRate}::numeric,
        ${totals.retentionCents}, ${totals.totalCents}, ${nowIso}, ${nowIso}
      WHERE NOT EXISTS (SELECT 1 FROM existing_receipt)
      RETURNING id
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (id, company_id, document_id, actor, event, created_at)
      SELECT ${eventId}, ${companyId}, inserted_receipt.id, ${actor},
        'created'::document_event_type, ${nowIso}
      FROM inserted_receipt
      RETURNING document_id
    )
    SELECT COALESCE(
      (SELECT document_id FROM inserted_event),
      (SELECT id FROM existing_receipt)
    ) AS receipt_id
  `);

  const row = firstExecutionRow<ReceiptRow>(result);
  if (row?.receipt_id) {
    return row.receipt_id;
  }

  // A concurrent insert lost the race against the unique index; the winner's
  // row is now visible to us.
  const [existing] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.paymentId, payment.id),
        eq(documents.documentType, "receipt"),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("No se ha podido generar el recibo.");
  }
  return existing.id;
}

/**
 * Generates a receipt directly as issued from a payment on the invoice
 * `:id`. Resolves an existing receipt for the payment before any quota
 * check, then routes every new receipt through the shared issuance guard
 * (T053) for company/series locks, numbering, snapshots and audit.
 */
export async function createReceiptFromPayment(
  input: {
    companyId: string;
    invoiceId: string;
    paymentId: string;
    actor: string;
    now?: Date;
  },
  dependencies: IssueDocumentDependencies,
): Promise<IssuedDocumentResult> {
  const database = dependencies.database ?? createDatabase();
  const now = dependencies.now ?? input.now ?? new Date();
  const invoice = await loadInvoice(database, input.companyId, input.invoiceId);
  const payment = await loadPayment(database, input.companyId, input.paymentId);
  const validation = validateReceiptSource(input.invoiceId, invoice, payment);
  if (!validation.valid) {
    throw receiptConflictError(validation.error);
  }

  await ensureDefaultSeries(database, input.companyId, "receipt", now);
  const receiptId = await resolveOrCreateDraftReceipt(
    database,
    input.companyId,
    input.actor,
    invoice,
    payment,
    now,
  );

  return issueDocument(
    {
      companyId: input.companyId,
      documentId: receiptId,
      actor: input.actor,
      idempotency: { kind: "receipt_for_payment", paymentId: input.paymentId },
    },
    { ...dependencies, database, now },
  );
}
