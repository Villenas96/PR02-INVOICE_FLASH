import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { documents } from "@/db/schema/document";
import { emailDeliveries } from "@/db/schema/email-delivery";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/pagination";
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
const cursorSchema = z
  .object({
    v: z.literal(1),
    id: z.string().uuid(),
  })
  .strict();

type DeliveryRow = typeof emailDeliveries.$inferSelect;
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

  if (apiError.status >= 500) {
    logSafe("error", "documents.email_deliveries_route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
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

/** Never exposes the recipient in clear: only the delivery lifecycle. */
function deliveryResponse(delivery: DeliveryRow) {
  return {
    id: delivery.id,
    status: delivery.status,
    attempt_count: delivery.attemptCount,
    last_error_code: delivery.lastErrorCode,
    sent_at: delivery.sentAt,
    created_at: delivery.createdAt,
  };
}

export async function GET(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    const pagination = parsePagination(searchParams);
    const cursorId = decodeCursor(pagination.cursor);
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const [context, params] = await Promise.all([
      contextPromise,
      paramsPromise,
    ]);
    const database = createDatabase();
    const [document] = await database
      .select({ id: documents.id })
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

    const rows = await database
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.documentId, params.id),
          eq(emailDeliveries.companyId, context.companyId),
          cursorId ? gt(emailDeliveries.id, cursorId) : undefined,
        ),
      )
      .orderBy(asc(emailDeliveries.id))
      .limit(pagination.limit + 1);
    const hasNextPage = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const lastItem = items.at(-1);

    return withRequestId(
      Response.json({
        items: items.map(deliveryResponse),
        next_cursor: hasNextPage && lastItem ? encodeCursor(lastItem.id) : null,
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
