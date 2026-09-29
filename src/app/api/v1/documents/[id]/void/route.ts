import { z } from "zod";

import { createDatabase } from "@/db";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import { voidIssuedDocument } from "@/services/document-void";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

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

  logSafe(
    apiError.status >= 500 ? "error" : "warn",
    "documents.void_route_failed",
    {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
      error_code: apiError.code,
    },
  );

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

function documentResponse(
  document: Awaited<ReturnType<typeof voidIssuedDocument>>,
) {
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
    subtotal_cents: document.subtotalCents,
    tax_breakdown: document.taxBreakdown,
    retention_rate: document.retentionRate,
    retention_cents: document.retentionCents,
    total_cents: document.totalCents,
    issuer_snapshot: document.issuerSnapshot,
    client_snapshot: document.clientSnapshot,
    pdf_status: document.pdfStatus,
    issued_at: document.issuedAt,
    voided_at: document.voidedAt,
  };
}

export async function POST(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const [context, params] = await Promise.all([
      contextPromise,
      paramsPromise,
    ]);
    const document = await voidIssuedDocument({
      database: createDatabase(),
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
    });

    logSafe("info", "documents.voided", {
      request_id: requestId,
      document_id: document.id,
      document_type: document.documentType,
    });
    return withRequestId(Response.json(documentResponse(document)), requestId);
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
