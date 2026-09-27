import { and, asc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { documentStatusEnum, documents } from "@/db/schema/document";
import { documentTypeEnum } from "@/db/schema/document-series";
import { payments } from "@/db/schema/payment";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/pagination";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import { createDraftDocument, type DocumentDetail } from "@/services/documents";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PAYMENT_STATUSES = ["pending", "partial", "paid", "overdue"] as const;

const collectionQuerySchema = z
  .object({
    type: z.enum(documentTypeEnum.enumValues).optional(),
    status: z.enum(documentStatusEnum.enumValues).optional(),
    payment_status: z.enum(PAYMENT_STATUSES).optional(),
    client_id: z.string().uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict()
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
    path: ["from"],
  });
const cursorSchema = z
  .object({
    v: z.literal(1),
    id: z.string().uuid(),
  })
  .strict();
const decimalSchema = z.union([z.string(), z.number()]);
const draftLineSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Añade una descripción a cada línea.")
      .max(1_000, "La descripción no puede superar 1.000 caracteres."),
    quantity: decimalSchema,
    unit_price_cents: z.number().int().min(0).max(MAX_POSTGRES_INTEGER),
    tax_rate: decimalSchema,
    discount_pct: decimalSchema.optional(),
  })
  .strict();
const createDraftSchema = z
  .object({
    doc_type: z.enum(["invoice", "proforma"]),
    client_id: z.string().uuid().nullable().optional(),
    issue_date: z.iso.date().optional(),
    due_date: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    lines: z
      .array(draftLineSchema)
      .min(1, "Añade al menos una línea al borrador.")
      .max(500, "El borrador no puede superar 500 líneas."),
  })
  .strict();

type DocumentRow = typeof documents.$inferSelect;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

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
    logSafe("error", "documents.collection_route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

function encodeCursor(id: string): string {
  const json = JSON.stringify({ v: 1, id });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return validate(cursorSchema, JSON.parse(new TextDecoder().decode(bytes)))
      .id;
  } catch {
    throw new ApiError(
      "validation_error",
      400,
      "El cursor de paginación no es válido.",
    );
  }
}

function madridDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
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
    notes: document.notes,
    subtotal_cents: document.subtotalCents,
    tax_breakdown: document.taxBreakdown,
    retention_rate: document.retentionRate,
    retention_cents: document.retentionCents,
    total_cents: document.totalCents,
    issuer_snapshot: document.issuerSnapshot,
    client_snapshot: document.clientSnapshot,
    converted_from_id: document.convertedFromId,
    converted_to_id: document.convertedToId,
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

function draftResponse(document: DocumentDetail) {
  return {
    ...documentResponse(document),
    lines: document.lines.map((line) => ({
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      tax_rate: line.taxRate,
      discount_pct: line.discountPercentage,
      line_subtotal_cents: line.lineSubtotalCents,
      line_tax_cents: line.lineTaxCents,
      line_total_cents: line.lineTotalCents,
    })),
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
  return sql<PaymentStatus | null>`
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

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    const query = validate(
      collectionQuerySchema,
      Object.fromEntries(searchParams.entries()),
    );
    const pagination = parsePagination(searchParams);
    const cursorId = decodeCursor(pagination.cursor);
    const context = await resolveCompanyContext(request);
    const database = createDatabase();
    const paidCents = paidCentsExpression(context.companyId);
    const paymentStatus = paymentStatusExpression(context.companyId);
    const conditions = [
      eq(documents.companyId, context.companyId),
      isNull(documents.deletedAt),
      query.type ? eq(documents.documentType, query.type) : undefined,
      query.status ? eq(documents.status, query.status) : undefined,
      query.client_id ? eq(documents.clientId, query.client_id) : undefined,
      query.from ? gte(documents.issueDate, query.from) : undefined,
      query.to ? lte(documents.issueDate, query.to) : undefined,
      query.payment_status
        ? sql`${paymentStatus} = ${query.payment_status}`
        : undefined,
      cursorId ? gt(documents.id, cursorId) : undefined,
    ].filter((condition) => condition !== undefined);

    const rows = await database
      .select({
        id: documents.id,
        documentType: documents.documentType,
        status: documents.status,
        fullNumber: documents.fullNumber,
        clientId: documents.clientId,
        issueDate: documents.issueDate,
        dueDate: documents.dueDate,
        totalCents: documents.totalCents,
        pdfStatus: documents.pdfStatus,
        issuedAt: documents.issuedAt,
        voidedAt: documents.voidedAt,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        paidCents,
        paymentStatus,
      })
      .from(documents)
      .where(and(...conditions))
      .orderBy(asc(documents.id))
      .limit(pagination.limit + 1);
    const hasNextPage = rows.length > pagination.limit;
    const page = rows.slice(0, pagination.limit);
    const lastItem = page.at(-1);

    return withRequestId(
      Response.json({
        items: page.map((row) => ({
          id: row.id,
          doc_type: row.documentType,
          status: row.status,
          full_number: row.fullNumber,
          client_id: row.clientId,
          issue_date: row.issueDate,
          due_date: row.dueDate,
          total_cents: row.totalCents,
          pdf_status: row.pdfStatus,
          issued_at: row.issuedAt,
          voided_at: row.voidedAt,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          paid_cents: row.paidCents,
          outstanding_cents: Math.max(row.totalCents - row.paidCents, 0),
          payment_status: row.paymentStatus,
        })),
        next_cursor: hasNextPage && lastItem ? encodeCursor(lastItem.id) : null,
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request);
    const inputPromise = parseJson(request, createDraftSchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    const createdDocument = await createDraftDocument({
      companyId: context.companyId,
      actor: context.userId,
      documentType: input.doc_type,
      clientId: input.client_id ?? null,
      issueDate: input.issue_date ?? madridDate(),
      dueDate: input.due_date ?? null,
      notes: input.notes ?? null,
      lines: input.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unit_price_cents,
        taxRate: line.tax_rate,
        discountPercentage: line.discount_pct ?? "0",
      })),
    });

    return withRequestId(
      Response.json(draftResponse(createdDocument), { status: 201 }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
