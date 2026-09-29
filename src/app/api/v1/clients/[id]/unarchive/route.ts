import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { clients } from "@/db/schema/client";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

type ClientRow = typeof clients.$inferSelect;
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
    "clients.unarchive_route_failed",
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

function clientResponse(client: ClientRow) {
  return {
    id: client.id,
    name: client.name,
    tax_id: client.taxId,
    address: client.address,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
    archived_at: client.archivedAt,
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
    const database = createDatabase();
    const now = new Date();
    const [unarchivedClient] = await database
      .update(clients)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(clients.id, params.id),
          eq(clients.companyId, context.companyId),
        ),
      )
      .returning();

    if (!unarchivedClient) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(clientResponse(unarchivedClient)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
