import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { catalogItems } from "@/db/schema/catalog-item";
import { matchesSearchText } from "@/db/search";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/pagination";
import { parseJson, validate } from "@/lib/api/validate";
import { createCatalogItemSchema } from "@/lib/catalog/schema";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { resolveCatalogTax } from "@/services/catalog-tax";
import { resolveCompanyContext } from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

const paginationQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.string().optional(),
    q: z.string().trim().max(200).optional(),
    archived: z.enum(["true", "false"]).optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    v: z.literal(1),
    id: z.string().uuid(),
  })
  .strict();
type CatalogItemRow = typeof catalogItems.$inferSelect;

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

  if (apiError.status >= 500) {
    logSafe("error", "catalog_items.route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

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
    tax_rate_id: item.taxRateId,
    unit: item.unit,
    archived_at: item.archivedAt,
  };
}

function encodeCursor(id: string): string {
  const json = JSON.stringify({ v: 1, id });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return validate(cursorSchema, JSON.parse(new TextDecoder().decode(bytes)))
      .id;
  } catch {
    throw new ApiError(
      "validation_error",
      400,
      "El cursor de paginación no es válido.",
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    const query = validate(
      paginationQuerySchema,
      Object.fromEntries(searchParams.entries()),
    );
    const pagination = parsePagination(searchParams);
    const cursorId = decodeCursor(pagination.cursor);
    const context = await resolveCompanyContext(request, { access: "read" });
    const database = createDatabase();

    const rows = await database
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.companyId, context.companyId),
          query.archived === "true"
            ? isNotNull(catalogItems.archivedAt)
            : isNull(catalogItems.archivedAt),
          query.q
            ? matchesSearchText(catalogItems.searchText, query.q)
            : undefined,
          cursorId ? gt(catalogItems.id, cursorId) : undefined,
        ),
      )
      .orderBy(asc(catalogItems.id))
      .limit(pagination.limit + 1);
    const hasNextPage = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const lastItem = items.at(-1);

    return withRequestId(
      Response.json({
        items: items.map(catalogItemResponse),
        next_cursor: hasNextPage && lastItem ? encodeCursor(lastItem.id) : null,
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const contextPromise = resolveCompanyContext(request, { access: "write" });
    const inputPromise = parseJson(request, createCatalogItemSchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    const database = createDatabase();
    const tax = await resolveCatalogTax(database, context.companyId, input, {
      useDefault: true,
    });
    const [createdItem] = await database
      .insert(catalogItems)
      .values({
        id: createUuidV7(),
        companyId: context.companyId,
        description: input.description,
        unitPriceCents: input.unit_price_cents,
        taxRate: tax.taxRate ?? "21.00",
        taxRateId: tax.taxRateId ?? null,
        unit: input.unit?.trim() ? input.unit.trim() : null,
      })
      .returning();

    if (!createdItem) {
      throw new Error("Catalog item insert returned no row.");
    }

    return withRequestId(
      Response.json(catalogItemResponse(createdItem), { status: 201 }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
