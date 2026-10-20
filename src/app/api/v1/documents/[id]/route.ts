import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { type documentLines, documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { payments } from "@/db/schema/payment";
import { shareLinks } from "@/db/schema/share-link";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import {
  deriveDeliveryNoteState,
  deriveQuoteState,
} from "@/lib/documents/conversion";
import { logSafe } from "@/lib/log";
import { madridDate } from "@/lib/plan";
import { auditActor, resolveCompanyContext } from "@/services/context";
import {
  clientDisplayFor,
  type DocumentDetail,
  type DocumentLinkRef,
  getDocumentDetail,
  loadDocumentClient,
  softDeleteDraftDocument,
  updateDraftDocument,
} from "@/services/documents";
import { reminderWarning, setDocumentReminders } from "@/services/reminders";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const decimalSchema = z.union([z.string(), z.number()]);
const draftLineSchema = z
  .object({
    description: z.string().trim().min(1).max(1_000),
    quantity: decimalSchema,
    unit_price_cents: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    tax_rate: decimalSchema,
    discount_pct: decimalSchema.optional(),
    tax_name: z.string().trim().min(1).max(30).optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    tax_rate_id: z.string().uuid().nullable().optional(),
    catalog_item_id: z.string().uuid().nullable().optional(),
  })
  .strict();
const updateDraftSchema = z
  .object({
    doc_type: z
      .enum(["invoice", "proforma", "quote", "delivery_note"])
      .optional(),
    valid_until: z.iso.date().nullable().optional(),
    client_id: z.string().uuid().nullable().optional(),
    series_id: z.string().uuid().nullable().optional(),
    collection_method_id: z.string().uuid().nullable().optional(),
    issue_date: z.iso.date().optional(),
    due_date: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    lines: z.array(draftLineSchema).max(500).optional(),
    // Allowed on issued invoices too: not fiscal content (FR-041).
    reminders_enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

type DocumentRow = DocumentDetail;
type RouteContext = {
  params: Promise<{ id: string }>;
};

function requestIdFrom(request: Request): {
  requestId: string;
  propagatedRequestId?: string;
} {
  const supplied = request.headers.get("x-request-id");
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) {
    return { requestId: supplied, propagatedRequestId: supplied };
  }
  return { requestId: crypto.randomUUID() };
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function routeErrorResponse(
  error: unknown,
  requestId: string,
  propagatedRequestId?: string,
): Response {
  const apiError = toApiError(error);

  if (apiError.status >= 500) {
    logSafe("error", "documents.detail_route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

function linksResponse(links: NonNullable<DocumentDetail["links"]>) {
  const ref = (link: DocumentLinkRef) => ({
    id: link.id,
    kind: link.kind,
    doc_type: link.documentType,
    full_number: link.fullNumber,
    status: link.status,
  });
  return { from: links.from.map(ref), to: links.to.map(ref) };
}

function derivedStateOf(document: DocumentRow): string | null {
  const targets = document.links?.to ?? [];
  if (document.documentType === "quote") {
    return deriveQuoteState({
      status: document.status,
      decision: document.quoteDecision,
      validUntil: document.validUntil,
      converted: targets.some(
        (link) => link.kind === "converted" && link.status !== "voided",
      ),
      today: madridDate(new Date()),
    });
  }
  if (document.documentType === "delivery_note") {
    return deriveDeliveryNoteState({
      status: document.status,
      invoiced: targets.some((link) => link.kind === "invoiced"),
    });
  }
  return null;
}

function documentResponse(document: DocumentRow) {
  return {
    id: document.id,
    doc_type: document.documentType,
    status: document.status,
    series_id: document.seriesId,
    number: document.number,
    full_number: document.fullNumber,
    client_id: document.clientId,
    issue_date: document.issueDate,
    due_date: document.dueDate,
    valid_until: document.validUntil,
    reminders_enabled: document.remindersEnabled,
    quote_decision: document.quoteDecision,
    quote_decided_at: document.quoteDecidedAt,
    derived_state: derivedStateOf(document),
    notes: document.notes,
    subtotal_cents: document.subtotalCents,
    tax_breakdown: document.taxBreakdown,
    retention_rate: document.retentionRate,
    retention_cents: document.retentionCents,
    total_cents: document.totalCents,
    issuer_snapshot: document.issuerSnapshot,
    client_snapshot: document.clientSnapshot,
    converted_from_id: document.convertedFromId ?? null,
    converted_to_id: document.convertedToId ?? null,
    document_links: document.links ? linksResponse(document.links) : undefined,
    invoice_id: document.invoiceId,
    payment_id: document.paymentId,
    pdf_status: document.pdfStatus,
    pdf_ready_at: document.pdfReadyAt,
    issued_at: document.issuedAt,
    voided_at: document.voidedAt,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

function lineResponse(line: typeof documentLines.$inferSelect) {
  return {
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: line.quantity,
    unit_price_cents: line.unitPriceCents,
    tax_rate: line.taxRate,
    discount_pct: line.discountPercentage,
    tax_name: line.taxName,
    unit: line.unit,
    tax_rate_id: line.taxRateId,
    catalog_item_id: line.catalogItemId,
    line_subtotal_cents: line.lineSubtotalCents,
    line_tax_cents: line.lineTaxCents,
    line_total_cents: line.lineTotalCents,
  };
}

function draftResponse(document: DocumentDetail) {
  return {
    ...documentResponse(document),
    lines: document.lines.map(lineResponse),
  };
}

function paidCentsExpression(companyId: string) {
  /**
   * Drizzle only fully qualifies `${documents.id}` when this fragment is
   * nested inside another `sql` template; used bare as a top-level select
   * field it resolves the bare `document_id = "id"` predicate against
   * `scoped_payment.id` instead of the outer document, always summing zero.
   * The inner/outer split forces qualification in both usages.
   */
  const correlatedSum = sql`COALESCE((
    SELECT SUM(scoped_payment.amount_cents)
    FROM ${payments} scoped_payment
    WHERE scoped_payment.document_id = ${documents.id}
      AND scoped_payment.company_id = ${companyId}
  ), 0)`;
  return sql<number>`${correlatedSum}`.mapWith(Number);
}

function paymentStatusExpression(companyId: string) {
  const paidCents = paidCentsExpression(companyId);
  return sql<"overdue" | "paid" | "partial" | "pending" | null>`
    CASE
      WHEN ${documents.status} <> 'issued'::document_status
        OR ${documents.documentType} <> 'invoice'::document_type
        THEN NULL
      WHEN ${paidCents} >= ${documents.totalCents} THEN 'paid'
      WHEN ${documents.dueDate} IS NOT NULL
        AND ${documents.dueDate} < (now() AT TIME ZONE 'Europe/Madrid')::date
        THEN 'overdue'
      WHEN ${paidCents} > 0 THEN 'partial'
      ELSE 'pending'
    END
  `;
}

export async function GET(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "read" });
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const [context, params] = await Promise.all([
      contextPromise,
      paramsPromise,
    ]);
    const database = createDatabase();
    const detailPromise = getDocumentDetail<DocumentDetail>({
      database,
      companyId: context.companyId,
      documentId: params.id,
    });
    const paymentsPromise = database
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.companyId, context.companyId),
          eq(payments.documentId, params.id),
        ),
      )
      .orderBy(asc(payments.paidOn), asc(payments.createdAt));
    const linksPromise = database
      .select({
        id: shareLinks.id,
        disabledAt: shareLinks.disabledAt,
        createdAt: shareLinks.createdAt,
        updatedAt: shareLinks.updatedAt,
      })
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.companyId, context.companyId),
          eq(shareLinks.documentId, params.id),
        ),
      )
      .orderBy(asc(shareLinks.createdAt));
    const eventsPromise = database
      .select()
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.companyId, context.companyId),
          eq(documentEvents.documentId, params.id),
        ),
      )
      .orderBy(asc(documentEvents.createdAt));
    const paidCents = paidCentsExpression(context.companyId);
    const paymentStatus = paymentStatusExpression(context.companyId);
    const paymentSummaryPromise = database
      .select({ paidCents, paymentStatus })
      .from(documents)
      .where(
        and(
          eq(documents.id, params.id),
          eq(documents.companyId, context.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    const clientPromise = loadDocumentClient(
      database,
      context.companyId,
      params.id,
    );

    const [
      document,
      documentPayments,
      documentLinks,
      documentEventsRows,
      paymentSummaryRows,
      liveClient,
    ] = await Promise.all([
      detailPromise,
      paymentsPromise,
      linksPromise,
      eventsPromise,
      paymentSummaryPromise,
      clientPromise,
    ]);
    const paymentSummary = paymentSummaryRows[0] ?? {
      paidCents: 0,
      paymentStatus: null,
    };

    return withRequestId(
      Response.json({
        ...draftResponse(document),
        client_display: clientDisplayFor(document.clientSnapshot, liveClient),
        reminder_warning:
          document.documentType === "invoice" && document.status === "issued"
            ? reminderWarning({
                clientEmail: liveClient?.email,
                clientReminders: liveClient?.remindersEnabled,
                documentReminders: document.remindersEnabled,
              })
            : null,
        payments: documentPayments.map((payment) => ({
          id: payment.id,
          amount_cents: payment.amountCents,
          confirmed_overpayment: payment.confirmedOverpayment,
          paid_on: payment.paidOn,
          method: payment.method,
          created_at: payment.createdAt,
          updated_at: payment.updatedAt,
        })),
        links: documentLinks.map((link) => ({
          id: link.id,
          disabled_at: link.disabledAt,
          created_at: link.createdAt,
          updated_at: link.updatedAt,
        })),
        events: documentEventsRows.map((event) => ({
          id: event.id,
          actor: event.actor,
          event: event.event,
          payload: event.payload,
          created_at: event.createdAt,
        })),
        paid_cents: paymentSummary.paidCents,
        outstanding_cents: Math.max(
          document.totalCents - paymentSummary.paidCents,
          0,
        ),
        payment_status: paymentSummary.paymentStatus,
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function PATCH(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "write" });
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, updateDraftSchema);
    const [context, params, input] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
    ]);
    const { reminders_enabled: remindersEnabled, ...draftInput } = input;
    if (remindersEnabled !== undefined) {
      await setDocumentReminders({
        companyId: context.companyId,
        documentId: params.id,
        enabled: remindersEnabled,
      });
      if (Object.values(draftInput).every((value) => value === undefined)) {
        const current = await getDocumentDetail<DocumentDetail>({
          companyId: context.companyId,
          documentId: params.id,
        });
        return withRequestId(Response.json(draftResponse(current)), requestId);
      }
    }
    const updatedDocument = await updateDraftDocument({
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
      eventActor: auditActor(context),
      ...(input.doc_type === undefined ? {} : { documentType: input.doc_type }),
      ...(input.valid_until === undefined
        ? {}
        : { validUntil: input.valid_until }),
      ...(input.client_id === undefined ? {} : { clientId: input.client_id }),
      ...(input.series_id === undefined ? {} : { seriesId: input.series_id }),
      ...(input.collection_method_id === undefined
        ? {}
        : { collectionMethodId: input.collection_method_id }),
      ...(input.issue_date === undefined
        ? {}
        : { issueDate: input.issue_date }),
      ...(input.due_date === undefined ? {} : { dueDate: input.due_date }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.lines === undefined
        ? {}
        : {
            lines: input.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPriceCents: line.unit_price_cents,
              taxRate: line.tax_rate,
              discountPercentage: line.discount_pct ?? "0",
              taxName: line.tax_name ?? "IVA",
              unit: line.unit?.trim() ? line.unit.trim() : null,
              taxRateId: line.tax_rate_id ?? null,
              catalogItemId: line.catalog_item_id ?? null,
            })),
          }),
    });

    return withRequestId(
      Response.json(draftResponse(updatedDocument)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function DELETE(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "write" });
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const [context, params] = await Promise.all([
      contextPromise,
      paramsPromise,
    ]);

    await softDeleteDraftDocument({
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
      eventActor: auditActor(context),
    });

    return withRequestId(new Response(null, { status: 204 }), requestId);
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
