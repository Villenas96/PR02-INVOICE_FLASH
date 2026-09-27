import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { catalogItems } from "@/db/schema/catalog-item";
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

type CatalogItemRow = typeof catalogItems.$inferSelect;
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
    "catalog_items.restore_route_failed",
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

function catalogItemResponse(item: CatalogItemRow) {
  return {
    id: item.id,
    description: item.description,
    unit_price_cents: item.unitPriceCents,
    tax_rate: item.taxRate,
    archived_at: item.archivedAt,
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
    const [restoredItem] = await database
      .update(catalogItems)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(catalogItems.id, params.id),
          eq(catalogItems.companyId, context.companyId),
        ),
      )
      .returning();

    if (!restoredItem) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(catalogItemResponse(restoredItem)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
