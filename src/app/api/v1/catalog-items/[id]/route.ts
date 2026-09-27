import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { catalogItems } from "@/db/schema/catalog-item";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const TAX_RATE_VALUES = ["0.00", "4.00", "10.00", "21.00"] as const;

const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const updateCatalogItemSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Indica una descripción para el concepto.")
      .max(1_000, "La descripción no puede superar 1.000 caracteres.")
      .optional(),
    unit_price_cents: z
      .number()
      .int("El precio debe ser un entero en céntimos.")
      .min(0, "El precio no puede ser negativo.")
      .max(MAX_POSTGRES_INTEGER)
      .optional(),
    tax_rate: z.enum(TAX_RATE_VALUES).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

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
    "catalog_items.detail_route_failed",
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

export async function PATCH(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, updateCatalogItemSchema);
    const [context, params, input] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
    ]);
    const database = createDatabase();
    const [updatedItem] = await database
      .update(catalogItems)
      .set({
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.unit_price_cents === undefined
          ? {}
          : { unitPriceCents: input.unit_price_cents }),
        ...(input.tax_rate === undefined ? {} : { taxRate: input.tax_rate }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(catalogItems.id, params.id),
          eq(catalogItems.companyId, context.companyId),
        ),
      )
      .returning();

    if (!updatedItem) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(catalogItemResponse(updatedItem)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function DELETE(
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
    const [archivedItem] = await database
      .update(catalogItems)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(catalogItems.id, params.id),
          eq(catalogItems.companyId, context.companyId),
        ),
      )
      .returning();

    if (!archivedItem) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(catalogItemResponse(archivedItem)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
