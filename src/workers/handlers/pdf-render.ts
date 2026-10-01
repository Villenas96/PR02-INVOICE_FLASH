import { asc, eq, sql } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { payments } from "@/db/schema/payment";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { renderDocumentPdf } from "@/services/pdf/render";
import type {
  DocumentPdfInput,
  DocumentPdfParty,
} from "@/services/pdf/template";
import { type PrivateBucket, storeDocumentPdf } from "@/services/storage";
import type { PdfRenderMessage } from "@/workers/messages";

interface PdfRenderHandlerDependencies {
  database?: Database;
  bucket: PrivateBucket;
  renderPdf?: (input: DocumentPdfInput) => Promise<Uint8Array>;
  now?: () => Date;
}

interface DocumentSnapshot extends Record<string, unknown> {
  legalName?: unknown;
  name?: unknown;
  taxId?: unknown;
  address?: unknown;
  email?: unknown;
}

/**
 * The stored document can never produce a PDF (e.g. an incomplete snapshot).
 * Retrying cannot fix it, so the document is marked failed instead of being
 * left pending forever.
 */
export class PdfInputError extends Error {
  override name = "PdfInputError";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function snapshotParty(
  value: unknown,
  role: "client" | "issuer",
  documentType: DocumentPdfInput["documentType"],
): DocumentPdfParty {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PdfInputError(
      `Falta el snapshot de ${role} para generar el PDF.`,
    );
  }

  const snapshot = value as DocumentSnapshot;
  const taxId = textOrNull(snapshot.taxId);
  const address = textOrNull(snapshot.address);
  const legalName =
    typeof snapshot.legalName === "string"
      ? snapshot.legalName
      : typeof snapshot.name === "string"
        ? snapshot.name
        : null;
  // The issuer always has full fiscal data (company readiness), and so does an
  // invoice client (required at issue): never render a non-compliant invoice.
  // Proforma (and receipt) clients may lack tax id or address.
  const requiresFiscalData = role === "issuer" || documentType === "invoice";
  if (!legalName || (requiresFiscalData && (!taxId || !address))) {
    throw new PdfInputError(`El snapshot de ${role} está incompleto.`);
  }

  return {
    legalName,
    taxId,
    addressLines: address ? [address] : [],
    email: typeof snapshot.email === "string" ? snapshot.email : null,
  };
}

function taxBreakdown(value: unknown): DocumentPdfInput["taxBreakdown"] {
  if (!Array.isArray(value)) {
    throw new PdfInputError("El desglose fiscal del documento no es válido.");
  }

  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !("rate" in entry) ||
      !("baseCents" in entry) ||
      !("taxCents" in entry) ||
      typeof entry.rate !== "string" ||
      !Number.isSafeInteger(entry.baseCents) ||
      !Number.isSafeInteger(entry.taxCents)
    ) {
      throw new PdfInputError("El desglose fiscal del documento no es válido.");
    }
    return {
      rate: entry.rate,
      baseCents: entry.baseCents as number,
      taxCents: entry.taxCents as number,
    };
  });
}

async function loadReceiptDetails(
  database: Database,
  invoiceId: string | null,
  paymentId: string | null,
): Promise<DocumentPdfInput["receipt"]> {
  if (!invoiceId || !paymentId) {
    throw new PdfInputError("Falta la factura o el pago de origen del recibo.");
  }

  const [sourceInvoice] = await database
    .select({ fullNumber: documents.fullNumber })
    .from(documents)
    .where(eq(documents.id, invoiceId))
    .limit(1);
  const [payment] = await database
    .select({ paidOn: payments.paidOn })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!sourceInvoice?.fullNumber || !payment) {
    throw new PdfInputError(
      "No se han encontrado los datos de origen del recibo.",
    );
  }

  return {
    sourceInvoiceFullNumber: sourceInvoice.fullNumber,
    paymentDate: payment.paidOn,
  };
}

async function loadPdfInput(
  database: Database,
  documentId: string,
): Promise<DocumentPdfInput | null> {
  const [document] = await database
    .select({
      documentType: documents.documentType,
      status: documents.status,
      fullNumber: documents.fullNumber,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      notes: documents.notes,
      subtotalCents: documents.subtotalCents,
      taxBreakdown: documents.taxBreakdown,
      retentionRate: documents.retentionRate,
      retentionCents: documents.retentionCents,
      totalCents: documents.totalCents,
      issuerSnapshot: documents.issuerSnapshot,
      clientSnapshot: documents.clientSnapshot,
      pdfStatus: documents.pdfStatus,
      invoiceId: documents.invoiceId,
      paymentId: documents.paymentId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (
    !document ||
    document.pdfStatus === "ready" ||
    document.pdfStatus === "failed"
  ) {
    return null;
  }
  if (
    (document.status !== "issued" && document.status !== "voided") ||
    (document.documentType !== "invoice" &&
      document.documentType !== "proforma" &&
      document.documentType !== "receipt") ||
    !document.fullNumber ||
    document.pdfStatus !== "pending"
  ) {
    throw new PdfInputError("El documento no admite generación de PDF.");
  }

  const lines =
    document.documentType === "receipt"
      ? []
      : await database
          .select({
            position: documentLines.position,
            description: documentLines.description,
            quantity: documentLines.quantity,
            unitPriceCents: documentLines.unitPriceCents,
            taxRate: documentLines.taxRate,
            lineSubtotalCents: documentLines.lineSubtotalCents,
            lineTaxCents: documentLines.lineTaxCents,
            lineTotalCents: documentLines.lineTotalCents,
          })
          .from(documentLines)
          .where(eq(documentLines.documentId, documentId))
          .orderBy(asc(documentLines.position));
  const receipt =
    document.documentType === "receipt"
      ? await loadReceiptDetails(
          database,
          document.invoiceId,
          document.paymentId,
        )
      : undefined;

  return {
    documentType: document.documentType,
    fullNumber: document.fullNumber,
    issueDate: document.issueDate,
    dueDate: document.dueDate,
    currency: "EUR",
    issuer: snapshotParty(
      document.issuerSnapshot,
      "issuer",
      document.documentType,
    ),
    client: snapshotParty(
      document.clientSnapshot,
      "client",
      document.documentType,
    ),
    lines,
    subtotalCents: document.subtotalCents,
    taxBreakdown: taxBreakdown(document.taxBreakdown),
    retentionRate: document.retentionRate,
    retentionCents: document.retentionCents,
    totalCents: document.totalCents,
    notes: document.notes,
    receipt,
  };
}

async function markPdfTerminal(
  database: Database,
  documentId: string,
  terminal: "failed" | "ready",
  now: Date,
): Promise<void> {
  const event =
    terminal === "ready" ? ("pdf_generated" as const) : ("pdf_failed" as const);
  const eventId = createUuidV7(now.getTime());
  const nowIso = now.toISOString();

  await database.execute(sql`
    WITH terminal_document AS (
      UPDATE ${documents} target
      SET
        pdf_status = ${terminal}::pdf_status,
        pdf_ready_at = ${terminal === "ready" ? sql`${nowIso}` : sql`NULL`},
        updated_at = ${nowIso}
      WHERE target.id = ${documentId}
        AND target.status IN (
          'issued'::document_status,
          'voided'::document_status
        )
        AND target.pdf_status = 'pending'::pdf_status
      RETURNING target.id, target.company_id
    )
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
      terminal_document.company_id,
      terminal_document.id,
      'system',
      ${event}::document_event_type,
      ${nowIso}
    FROM terminal_document
    ON CONFLICT DO NOTHING
  `);
}

async function processPdf(
  message: PdfRenderMessage,
  dependencies: PdfRenderHandlerDependencies,
): Promise<void> {
  const database = dependencies.database ?? createDatabase();
  let input: DocumentPdfInput | null;
  try {
    input = await loadPdfInput(database, message.documentId);
  } catch (error) {
    if (!(error instanceof PdfInputError)) {
      throw error;
    }
    // Permanent: mark the document failed (the API then answers 409 and the
    // UI stops polling) and acknowledge instead of retrying a lost cause.
    await markPdfTerminal(
      database,
      message.documentId,
      "failed",
      dependencies.now?.() ?? new Date(),
    );
    logSafe("warn", "pdf.input_invalid", { error_type: error.name });
    return;
  }
  if (!input) {
    return;
  }

  try {
    const bytes = await (dependencies.renderPdf ?? renderDocumentPdf)(input);
    await storeDocumentPdf(dependencies.bucket, message.documentId, bytes);
    await markPdfTerminal(
      database,
      message.documentId,
      "ready",
      dependencies.now?.() ?? new Date(),
    );
  } catch (error) {
    await markPdfTerminal(
      database,
      message.documentId,
      "failed",
      dependencies.now?.() ?? new Date(),
    );
    throw error;
  }
}

export function createPdfRenderHandler(
  dependencies: PdfRenderHandlerDependencies,
): (message: PdfRenderMessage) => Promise<void> {
  const inFlight = new Map<string, Promise<void>>();

  return async (message) => {
    const existing = inFlight.get(message.documentId);
    if (existing) {
      await existing;
      return;
    }

    const processing = processPdf(message, dependencies).finally(() => {
      if (inFlight.get(message.documentId) === processing) {
        inFlight.delete(message.documentId);
      }
    });
    inFlight.set(message.documentId, processing);
    await processing;
  };
}
