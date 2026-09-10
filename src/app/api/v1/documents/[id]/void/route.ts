import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, type Database } from "@/db";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { createUuidV7 } from "@/lib/ids";
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

interface VoidedRow extends Record<string, unknown> {
  document_id: string;
}

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
    "documents.void_route_failed",
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

function firstVoidedRow(result: unknown): VoidedRow | undefined {
  if (Array.isArray(result)) {
    return result[0] as VoidedRow | undefined;
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows[0] as VoidedRow | undefined;
  }
  return undefined;
}

async function loadVoidedDocument(
  database: Database,
  companyId: string,
  documentId: string,
) {
  const [document] = await database
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.companyId, companyId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!document) {
    throw new ResourceNotFoundError();
  }
  if (document.status !== "voided") {
    throw new ApiError(
      "conflict",
      409,
      "Solo puedes anular documentos que ya estén emitidos.",
    );
  }
  return document;
}

export async function voidIssuedDocument(input: {
  database: Database;
  companyId: string;
  documentId: string;
  actor: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const eventId = createUuidV7(now.getTime());
  const nowIso = now.toISOString();
  const result = await input.database.execute<VoidedRow>(sql`
    WITH voided_document AS (
      UPDATE ${documents} target
      SET
        status = 'voided'::document_status,
        voided_at = ${nowIso},
        updated_at = ${nowIso}
      WHERE target.id = ${input.documentId}
        AND target.company_id = ${input.companyId}
        AND target.status = 'issued'::document_status
        AND target.deleted_at IS NULL
      RETURNING target.id, target.company_id
    ),
    inserted_event AS (
      INSERT INTO ${documentEvents} (
        id,
        company_id,
        document_id,
        actor,
        event,
        created_at
      )
      SELECT
        ${eventId},
        voided_document.company_id,
        voided_document.id,
        ${input.actor},
        'voided'::document_event_type,
        ${nowIso}
      FROM voided_document
      RETURNING document_id
    )
    SELECT inserted_event.document_id
    FROM inserted_event
  `);

  const row = firstVoidedRow(result);
  if (!row) {
    const [existing] = await input.database
      .select({ status: documents.status })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.documentId),
          eq(documents.companyId, input.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new ResourceNotFoundError();
    }
    throw new ApiError(
      "conflict",
      409,
      existing.status === "voided"
        ? "El documento ya está anulado."
        : "Solo puedes anular documentos que ya estén emitidos.",
    );
  }

  return loadVoidedDocument(input.database, input.companyId, row.document_id);
}

function documentResponse(
  document: Awaited<ReturnType<typeof voidIssuedDocument>>,
) {
  return {
    id: document.id,
    doc_type: document.documentType,
    status: document.status,
    series_id: document.seriesId,
    number: document.number,
    full_number: document.fullNumber,
    client_id: document.clientId,
    issue_date: document.issueDate,
    due_date: document.dueDate,
    subtotal_cents: document.subtotalCents,
    tax_breakdown: document.taxBreakdown,
    retention_rate: document.retentionRate,
    retention_cents: document.retentionCents,
    total_cents: document.totalCents,
    issuer_snapshot: document.issuerSnapshot,
    client_snapshot: document.clientSnapshot,
    pdf_status: document.pdfStatus,
    issued_at: document.issuedAt,
    voided_at: document.voidedAt,
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
    const document = await voidIssuedDocument({
      database: createDatabase(),
      companyId: context.companyId,
      documentId: params.id,
      actor: context.userId,
    });

    logSafe("info", "documents.voided", {
      request_id: requestId,
      document_id: document.id,
      document_type: document.documentType,
    });
    return withRequestId(Response.json(documentResponse(document)), requestId);
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
