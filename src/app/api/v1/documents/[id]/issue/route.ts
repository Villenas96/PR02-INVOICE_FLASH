import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

import { createDatabase } from "@/db";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import {
  issueDocument,
  type PdfRenderQueue,
} from "@/services/document-issuance";

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
    "documents.issue_route_failed",
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

async function pdfRenderQueue(): Promise<PdfRenderQueue> {
  const cloudflare = await getCloudflareContext();
  const queue = (
    cloudflare.env as {
      PDF_RENDER_QUEUE?: PdfRenderQueue;
    }
  ).PDF_RENDER_QUEUE;

  if (!queue) {
    throw new ApiError(
      "internal_error",
      500,
      "No se ha podido iniciar la generación del PDF.",
    );
  }
  return queue;
}

function issuedDocumentResponse(
  document: Awaited<ReturnType<typeof issueDocument>>,
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
    const queuePromise = pdfRenderQueue();
    const [context, params, queue] = await Promise.all([
      contextPromise,
      paramsPromise,
      queuePromise,
    ]);
    const document = await issueDocument(
      {
        companyId: context.companyId,
        documentId: params.id,
        actor: context.userId,
      },
      {
        database: createDatabase(),
        queue,
      },
    );

    logSafe("info", "documents.issued", {
      request_id: requestId,
      document_id: document.id,
      document_type: document.documentType,
    });
    return withRequestId(
      Response.json(issuedDocumentResponse(document)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
