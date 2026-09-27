import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { documents } from "@/db/schema/document";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import type { PdfRenderQueue } from "@/services/document-issuance";
import { createReceiptFromPayment } from "@/services/document-receipts";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const receiptBodySchema = z
  .object({
    payment_id: z.string().uuid(),
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
    "documents.receipt_route_failed",
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
  const queue = (cloudflare.env as { PDF_RENDER_QUEUE?: PdfRenderQueue })
    .PDF_RENDER_QUEUE;

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
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, receiptBodySchema);
    const queuePromise = pdfRenderQueue();
    const [context, params, input, queue] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
      queuePromise,
    ]);
    const database = createDatabase();

    const isNewReceipt = await isFreshReceipt(
      database,
      context.companyId,
      input.payment_id,
    );
    const receipt = await createReceiptFromPayment(
      {
        companyId: context.companyId,
        invoiceId: params.id,
        paymentId: input.payment_id,
        actor: context.userId,
      },
      { database, queue },
    );

    return withRequestId(
      Response.json(
        {
          id: receipt.id,
          doc_type: receipt.documentType,
          status: receipt.status,
          full_number: receipt.fullNumber,
          total_cents: receipt.totalCents,
          pdf_status: receipt.pdfStatus,
          issued_at: receipt.issuedAt,
        },
        { status: isNewReceipt ? 201 : 200 },
      ),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

/**
 * Read before the mutation so the response status (201 new vs 200 existing)
 * reflects whether this call is the one that generates the receipt.
 */
async function isFreshReceipt(
  database: Database,
  companyId: string,
  paymentId: string,
): Promise<boolean> {
  const [existing] = await database
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.paymentId, paymentId),
        eq(documents.companyId, companyId),
      ),
    )
    .limit(1);
  return !existing;
}
