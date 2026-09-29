import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { executionRows } from "@/db/result";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { documentSeries } from "@/db/schema/document-series";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const routeParamsSchema = z.object({
  id: z.string().uuid(),
});
const updateSeriesSchema = z
  .object({
    prefix: z.string().trim().min(1).max(50).optional(),
    next_number: z.number().int().min(1).max(MAX_POSTGRES_INTEGER).optional(),
    is_default: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function routeErrorResponse(
  error: unknown,
  requestId: string,
  propagatedRequestId?: string,
): Response {
  const normalizedError = isUniqueViolation(error)
    ? new ApiError(
        "conflict",
        409,
        "Ya existe una serie con ese tipo y prefijo.",
      )
    : toApiError(error);

  if (normalizedError.status >= 500) {
    logSafe("error", "series.update_route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(normalizedError, propagatedRequestId),
    requestId,
  );
}

function seriesResponse(series: typeof documentSeries.$inferSelect) {
  return {
    id: series.id,
    doc_type: series.documentType,
    prefix: series.prefix,
    next_number: series.nextNumber,
    is_default: series.isDefault,
  };
}

export async function PATCH(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const companyContextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, updateSeriesSchema);
    const [companyContext, params, input] = await Promise.all([
      companyContextPromise,
      paramsPromise,
      inputPromise,
    ]);
    const database = createDatabase();
    const changesNumbering =
      input.prefix !== undefined || input.next_number !== undefined;
    const result = await database.execute<{ id: string }>(sql`
      WITH locked_company AS MATERIALIZED (
        SELECT ${companies.id} AS id
        FROM ${companies}
        WHERE ${companies.id} = ${companyContext.companyId}
          AND ${companies.userId} = ${companyContext.userId}
        FOR UPDATE
      ),
      target AS MATERIALIZED (
        SELECT
          target_series.id,
          target_series.company_id,
          target_series.document_type
        FROM ${documentSeries} target_series
        JOIN locked_company
          ON locked_company.id = target_series.company_id
        WHERE target_series.id = ${params.id}
        FOR UPDATE OF target_series
      ),
      usage AS MATERIALIZED (
        SELECT EXISTS (
          SELECT 1
          FROM ${documents} used_document
          JOIN target ON target.id = used_document.series_id
          WHERE used_document.company_id = ${companyContext.companyId}
            AND used_document.status IN ('issued', 'voided')
        ) AS is_used
      ),
      unset_default AS (
        UPDATE ${documentSeries} current_default
        SET is_default = FALSE
        FROM target, usage
        WHERE ${input.is_default === true}
          AND (
            NOT ${changesNumbering}
            OR NOT usage.is_used
          )
          AND current_default.company_id = target.company_id
          AND current_default.document_type = target.document_type
          AND current_default.id <> target.id
          AND current_default.is_default
        RETURNING current_default.id
      ),
      unset_barrier AS (
        SELECT count(*) AS changed
        FROM unset_default
      )
      UPDATE ${documentSeries} target_series
      SET
        prefix = CASE
          WHEN ${input.prefix !== undefined} THEN ${input.prefix ?? ""}
          ELSE target_series.prefix
        END,
        next_number = CASE
          WHEN ${input.next_number !== undefined} THEN ${input.next_number ?? 1}
          ELSE target_series.next_number
        END,
        is_default = CASE
          WHEN ${input.is_default === true} THEN TRUE
          ELSE target_series.is_default
        END
      FROM target, usage, unset_barrier
      WHERE target_series.id = target.id
        AND (
          NOT ${changesNumbering}
          OR NOT usage.is_used
        )
      RETURNING target_series.id
    `);

    if (executionRows<{ id: string }>(result).length === 0) {
      const [existingSeries] = await database
        .select({ id: documentSeries.id })
        .from(documentSeries)
        .where(
          and(
            eq(documentSeries.id, params.id),
            eq(documentSeries.companyId, companyContext.companyId),
          ),
        )
        .limit(1);

      if (!existingSeries) {
        throw new ResourceNotFoundError();
      }
      throw new ApiError(
        "conflict",
        409,
        "No puedes cambiar el prefijo ni el siguiente número de una serie que ya se ha usado.",
      );
    }

    const [updatedSeries] = await database
      .select()
      .from(documentSeries)
      .where(
        and(
          eq(documentSeries.id, params.id),
          eq(documentSeries.companyId, companyContext.companyId),
        ),
      )
      .limit(1);

    if (!updatedSeries) {
      throw new ResourceNotFoundError();
    }

    return withRequestId(
      Response.json(seriesResponse(updatedSeries)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
