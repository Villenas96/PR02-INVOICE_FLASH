import { z } from "zod";

import { createDatabase } from "@/db";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import {
  createDraftDocument,
  type DocumentDetail,
  getDocumentDetail,
} from "@/services/documents";

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
    "documents.duplicate_route_failed",
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
    const database = createDatabase();
    const source = await getDocumentDetail<DocumentDetail>({
      database,
      companyId: context.companyId,
      documentId: params.id,
    });

    if (source.documentType === "receipt") {
      throw new ApiError(
        "conflict",
        409,
        "Los recibos no se pueden duplicar; genera uno nuevo desde un pago.",
      );
    }

    const now = new Date();
    const duplicated = await createDraftDocument(
      {
        companyId: context.companyId,
        actor: context.userId,
        documentType: source.documentType,
        clientId: source.clientId,
        issueDate: madridDate(now),
        dueDate: null,
        notes: source.notes,
        lines: source.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          taxRate: line.taxRate,
          discountPercentage: line.discountPercentage,
        })),
      },
      { database, now },
    );

    await database.insert(documentEvents).values({
      id: createUuidV7(now.getTime()),
      companyId: context.companyId,
      documentId: duplicated.id,
      actor: context.userId,
      event: "duplicated",
      payload: { source_document_id: params.id },
      createdAt: now,
    });

    return withRequestId(
      Response.json(
        {
          id: duplicated.id,
          doc_type: duplicated.documentType,
          status: duplicated.status,
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
