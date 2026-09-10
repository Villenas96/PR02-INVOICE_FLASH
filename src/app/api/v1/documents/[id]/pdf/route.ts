import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { documents } from "@/db/schema/document";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import {
  getPrivateObject,
  type PrivateBucket,
  pdfObjectKey,
} from "@/services/storage";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const PDF_RETRY_AFTER_SECONDS = 2;
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
    "documents.pdf_route_failed",
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

async function privateBucket(): Promise<PrivateBucket> {
  const { env } = await getCloudflareContext({ async: true });
  const bucket = (
    env as CloudflareEnv & {
      STORAGE_BUCKET?: PrivateBucket;
    }
  ).STORAGE_BUCKET;

  if (!bucket) {
    throw new ApiError(
      "internal_error",
      500,
      "No se ha podido acceder al PDF en este momento.",
    );
  }
  return bucket;
}

function attachmentFilename(fullNumber: string): string {
  const safeNumber =
    fullNumber
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "documento";
  return `factura-${safeNumber}.pdf`;
}

function failedPdfError(): ApiError {
  return new ApiError(
    "pdf_generation_failed",
    409,
    "No se ha podido generar el PDF. Reintenta la generación desde el documento.",
  );
}

export async function GET(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const bucketPromise = privateBucket();
    const [context, params, bucket] = await Promise.all([
      contextPromise,
      paramsPromise,
      bucketPromise,
    ]);
    const database = createDatabase();
    const [document] = await database
      .select({
        status: documents.status,
        fullNumber: documents.fullNumber,
        pdfStatus: documents.pdfStatus,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, params.id),
          eq(documents.companyId, context.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!document) {
      throw new ResourceNotFoundError();
    }
    if (
      (document.status !== "issued" && document.status !== "voided") ||
      !document.fullNumber ||
      !document.pdfStatus
    ) {
      throw new ApiError(
        "conflict",
        409,
        "Emite el documento antes de descargar su PDF.",
      );
    }
    if (document.pdfStatus === "pending") {
      const response = Response.json(
        { status: "processing", code: "pdf_processing" },
        { status: 202 },
      );
      response.headers.set("Retry-After", PDF_RETRY_AFTER_SECONDS.toString());
      return withRequestId(response, requestId);
    }
    if (document.pdfStatus === "failed") {
      throw failedPdfError();
    }

    const object = await getPrivateObject(bucket, pdfObjectKey(params.id));
    if (!object) {
      logSafe("error", "documents.pdf_object_missing", {
        request_id: requestId,
        document_id: params.id,
      });
      throw failedPdfError();
    }

    return withRequestId(
      new Response(object.body, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${attachmentFilename(document.fullNumber)}"`,
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
        },
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
