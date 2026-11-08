import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

import { createDatabase } from "@/db";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import {
  convertAndIssue,
  convertDocument,
} from "@/services/document-conversion";
import type { PdfRenderQueue } from "@/services/document-issuance";
import { type DocumentDetail, getDocumentDetail } from "@/services/documents";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const convertBodySchema = z
  .object({
    // v1 clients send no type: a proforma converts into an invoice.
    target_type: z
      .enum(["invoice", "proforma", "delivery_note"])
      .optional()
      .default("invoice"),
    issue: z.boolean().optional().default(false),
    confirm_repeat: z.boolean().optional().default(false),
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
    "documents.convert_route_failed",
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
    cloudflare.env as unknown as { PDF_RENDER_QUEUE?: PdfRenderQueue }
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

export async function POST(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "write" });
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, convertBodySchema);
    const [context, params, input] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
    ]);

    const conversion = {
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
      targetType: input.target_type,
      confirmRepeat: input.confirm_repeat,
      idempotencyKey: parseIdempotencyKey(request),
    };
    if (input.issue) {
      const queue = await pdfRenderQueue();
      const database = createDatabase();
      const issued = await convertAndIssue(conversion, { database, queue });
      return withRequestId(
        Response.json({
          id: issued.id,
          doc_type: issued.documentType,
          status: issued.status,
          full_number: issued.fullNumber,
          client_id: issued.clientId,
          issue_date: issued.issueDate,
          due_date: issued.dueDate,
          total_cents: issued.totalCents,
          pdf_status: issued.pdfStatus,
          issued_at: issued.issuedAt,
        }),
        requestId,
      );
    }

    const draft = await convertDocument(conversion);
    const detail = await getDocumentDetail<DocumentDetail>({
      companyId: context.companyId,
      documentId: draft.id,
    });

    return withRequestId(
      Response.json({
        id: detail.id,
        doc_type: detail.documentType,
        status: detail.status,
        client_id: detail.clientId,
        total_cents: detail.totalCents,
        converted_from_id: detail.convertedFromId,
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
