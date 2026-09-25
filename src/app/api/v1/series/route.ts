import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { companies } from "@/db/schema/company";
import { documentSeries, documentTypeEnum } from "@/db/schema/document-series";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/pagination";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const DOCUMENT_TYPES = documentTypeEnum.enumValues;

const documentTypeSchema = z.enum(DOCUMENT_TYPES);
const cursorSchema = z.object({
  v: z.literal(1),
  id: z.string().uuid(),
});
const createSeriesSchema = z
  .object({
    doc_type: documentTypeSchema,
    prefix: z.string().trim().min(1).max(50),
    next_number: z.number().int().min(1).max(MAX_POSTGRES_INTEGER).default(1),
    is_default: z.boolean().default(false),
  })
  .strict();

type SeriesRow = typeof documentSeries.$inferSelect;

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
    logSafe("error", "series.route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(normalizedError, propagatedRequestId),
    requestId,
  );
}

function seriesResponse(series: SeriesRow) {
  return {
    id: series.id,
    doc_type: series.documentType,
    prefix: series.prefix,
    next_number: series.nextNumber,
    is_default: series.isDefault,
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

function currentMadridYear(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Madrid",
      year: "numeric",
    }).format(now),
  );
}

async function ensureInvoiceSeries(
  database: Database,
  companyId: string,
): Promise<void> {
  const [existingSeries] = await database
    .select({ id: documentSeries.id })
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, companyId),
        eq(documentSeries.documentType, "invoice"),
      ),
    )
    .limit(1);

  if (existingSeries) {
    return;
  }

  await database.execute(sql`
    WITH locked_company AS MATERIALIZED (
      SELECT ${companies.id} AS id
      FROM ${companies}
      WHERE ${companies.id} = ${companyId}
      FOR UPDATE
    )
    INSERT INTO ${documentSeries} (
      ${sql.identifier(documentSeries.id.name)},
      ${sql.identifier(documentSeries.companyId.name)},
      ${sql.identifier(documentSeries.documentType.name)},
      ${sql.identifier(documentSeries.prefix.name)},
      ${sql.identifier(documentSeries.nextNumber.name)},
      ${sql.identifier(documentSeries.isDefault.name)}
    )
    SELECT
      ${crypto.randomUUID()},
      locked_company.id,
      'invoice'::document_type,
      ${`${currentMadridYear()}-`},
      1,
      TRUE
    FROM locked_company
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${documentSeries} existing
      WHERE existing.company_id = locked_company.id
        AND existing.document_type = 'invoice'::document_type
    )
    ON CONFLICT DO NOTHING
  `);
}

async function loadCreatedSeries(
  database: Database,
  companyId: string,
  seriesId: string,
): Promise<SeriesRow> {
  const [createdSeries] = await database
    .select()
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.id, seriesId),
        eq(documentSeries.companyId, companyId),
      ),
    )
    .limit(1);

  if (!createdSeries) {
    throw new ResourceNotFoundError();
  }
  return createdSeries;
}

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    const pagination = parsePagination(searchParams);
    const documentType = validate(
      documentTypeSchema.optional(),
      searchParams.get("doc_type") ?? undefined,
    );
    const cursorId = decodeCursor(pagination.cursor);
    const context = await resolveCompanyContext(request);
    const database = createDatabase();

    await ensureInvoiceSeries(database, context.companyId);

    const conditions = [
      eq(documentSeries.companyId, context.companyId),
      documentType ? eq(documentSeries.documentType, documentType) : undefined,
      cursorId ? gt(documentSeries.id, cursorId) : undefined,
    ].filter((condition) => condition !== undefined);
    const rows = await database
      .select()
      .from(documentSeries)
      .where(and(...conditions))
      .orderBy(asc(documentSeries.id))
      .limit(pagination.limit + 1);
    const hasNextPage = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const lastItem = items.at(-1);

    return withRequestId(
      Response.json({
        items: items.map(seriesResponse),
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
    const contextPromise = resolveCompanyContext(request);
    const inputPromise = parseJson(request, createSeriesSchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    const database = createDatabase();
    const seriesId = crypto.randomUUID();

    await ensureInvoiceSeries(database, context.companyId);

    await database.execute(sql`
      WITH locked_company AS MATERIALIZED (
        SELECT ${companies.id} AS id
        FROM ${companies}
        WHERE ${companies.id} = ${context.companyId}
          AND ${companies.userId} = ${context.userId}
        FOR UPDATE
      ),
      existing_default AS MATERIALIZED (
        SELECT existing.id
        FROM ${documentSeries} existing
        JOIN locked_company ON locked_company.id = existing.company_id
        WHERE existing.document_type = ${input.doc_type}::document_type
          AND existing.is_default
      ),
      unset_default AS (
        UPDATE ${documentSeries} existing
        SET is_default = FALSE
        FROM locked_company
        WHERE ${input.is_default}
          AND existing.company_id = locked_company.id
          AND existing.document_type = ${input.doc_type}::document_type
          AND existing.is_default
        RETURNING existing.id
      ),
      unset_barrier AS (
        SELECT count(*) AS changed
        FROM unset_default
      )
      INSERT INTO ${documentSeries} (
        ${sql.identifier(documentSeries.id.name)},
        ${sql.identifier(documentSeries.companyId.name)},
        ${sql.identifier(documentSeries.documentType.name)},
        ${sql.identifier(documentSeries.prefix.name)},
        ${sql.identifier(documentSeries.nextNumber.name)},
        ${sql.identifier(documentSeries.isDefault.name)}
      )
      SELECT
        ${seriesId},
        locked_company.id,
        ${input.doc_type}::document_type,
        ${input.prefix},
        ${input.next_number},
        (
          ${input.is_default}
          OR NOT EXISTS (SELECT 1 FROM existing_default)
        )
      FROM locked_company
      CROSS JOIN unset_barrier
    `);

    const createdSeries = await loadCreatedSeries(
      database,
      context.companyId,
      seriesId,
    );
    return withRequestId(
      Response.json(seriesResponse(createdSeries), { status: 201 }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
