import { z } from "zod";

import { createDatabase } from "@/db";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import { duplicateDocument } from "@/services/documents";

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
    const [context, params] = await Promise.all([
      contextPromise,
      paramsPromise,
    ]);
    const { document: duplicated, warnings } = await duplicateDocument(
      {
        companyId: context.companyId,
        documentId: params.id,
        actor: context.userId,
      },
      { database: createDatabase() },
    );

    return withRequestId(
      Response.json(
        {
          id: duplicated.id,
          doc_type: duplicated.documentType,
          status: duplicated.status,
          warnings,
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
