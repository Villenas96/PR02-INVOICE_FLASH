import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { documents } from "@/db/schema/document";
import { shareLinks } from "@/db/schema/share-link";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  getPrivateObject,
  type PrivateBucket,
  pdfObjectKey,
} from "@/services/storage";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const PDF_RETRY_AFTER_SECONDS = 2;
const routeParamsSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

type RouteContext = {
  params: Promise<{ token: string }>;
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

  // The token is never included: it is the public credential for this page.
  if (apiError.status >= 500) {
    logSafe("error", "public.pdf_route_failed", { request_id: requestId });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

async function privateBucket(): Promise<PrivateBucket> {
  const { env } = await getCloudflareContext({ async: true });
  const bucket = (env as CloudflareEnv & { STORAGE_BUCKET?: PrivateBucket })
    .STORAGE_BUCKET;

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

export async function GET(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const params = validate(routeParamsSchema, await routeContext.params);
    const bucket = await privateBucket();
    const database = createDatabase();
    const [row] = await database
      .select({
        documentId: documents.id,
        fullNumber: documents.fullNumber,
        pdfStatus: documents.pdfStatus,
        deletedAt: documents.deletedAt,
      })
      .from(shareLinks)
      .innerJoin(documents, eq(documents.id, shareLinks.documentId))
      .where(
        and(eq(shareLinks.token, params.token), isNull(shareLinks.disabledAt)),
      )
      .limit(1);

    if (!row || row.deletedAt || !row.fullNumber || !row.pdfStatus) {
      throw new ApiError(
        "resource_not_found",
        404,
        "No se ha encontrado el recurso solicitado.",
      );
    }
    if (row.pdfStatus === "pending") {
      const response = Response.json(
        { status: "processing", code: "pdf_processing" },
        { status: 202 },
      );
      response.headers.set("Retry-After", PDF_RETRY_AFTER_SECONDS.toString());
      return withRequestId(response, requestId);
    }
    if (row.pdfStatus === "failed") {
      throw new ApiError(
        "pdf_generation_failed",
        409,
        "No se ha podido generar el PDF de este documento.",
      );
    }

    const object = await getPrivateObject(bucket, pdfObjectKey(row.documentId));
    if (!object) {
      logSafe("error", "public.pdf_object_missing", { request_id: requestId });
      throw new ApiError(
        "pdf_generation_failed",
        409,
        "No se ha podido generar el PDF de este documento.",
      );
    }

    return withRequestId(
      new Response(object.body, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${attachmentFilename(row.fullNumber)}"`,
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
        },
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
