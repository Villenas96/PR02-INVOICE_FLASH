import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { documents } from "@/db/schema/document";
import { payments } from "@/db/schema/payment";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

const dashboardQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "La fecha inicial no puede ser posterior a la fecha final.",
    path: ["from"],
  });

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
    logSafe("error", "dashboard.route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

function paidCentsExpression(companyId: string) {
  /**
   * Drizzle only fully qualifies `${documents.id}` when this fragment is
   * nested inside another `sql` template; used bare as a top-level select
   * field it resolves the bare `document_id = "id"` predicate against
   * `scoped_payment.id` instead of the outer document, always summing zero.
   * The inner/outer split forces qualification in every usage below.
   */
  const correlatedSum = sql`COALESCE((
    SELECT SUM(scoped_payment.amount_cents)
    FROM ${payments} scoped_payment
    WHERE scoped_payment.document_id = ${documents.id}
      AND scoped_payment.company_id = ${companyId}
  ), 0)`;
  return sql<number>`${correlatedSum}`.mapWith(Number);
}

function isOverdueExpression() {
  return sql`(
    ${documents.dueDate} IS NOT NULL
    AND ${documents.dueDate} < (now() AT TIME ZONE 'Europe/Madrid')::date
  )`;
}

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    const query = validate(
      dashboardQuerySchema,
      Object.fromEntries(searchParams.entries()),
    );
    const context = await resolveCompanyContext(request);
    const database = createDatabase();
    const paidCents = paidCentsExpression(context.companyId);
    const isOverdue = isOverdueExpression();
    const isPaid = sql`${paidCents} >= ${documents.totalCents}`;
    const outstanding = sql<number>`GREATEST(${documents.totalCents} - ${paidCents}, 0)`;

    const [row] = await database
      .select({
        paidTotal: sql<number>`COALESCE(SUM(${paidCents}), 0)`.mapWith(Number),
        pendingTotal:
          sql<number>`COALESCE(SUM(CASE WHEN NOT (${isPaid}) AND NOT (${isOverdue}) THEN ${outstanding} ELSE 0 END), 0)`.mapWith(
            Number,
          ),
        overdueTotal:
          sql<number>`COALESCE(SUM(CASE WHEN NOT (${isPaid}) AND ${isOverdue} THEN ${outstanding} ELSE 0 END), 0)`.mapWith(
            Number,
          ),
        pendingCount:
          sql<number>`COUNT(*) FILTER (WHERE NOT (${isPaid}) AND NOT (${isOverdue}) AND ${paidCents} = 0)`.mapWith(
            Number,
          ),
        partialCount:
          sql<number>`COUNT(*) FILTER (WHERE NOT (${isPaid}) AND NOT (${isOverdue}) AND ${paidCents} > 0)`.mapWith(
            Number,
          ),
        paidCount: sql<number>`COUNT(*) FILTER (WHERE ${isPaid})`.mapWith(
          Number,
        ),
        overdueCount:
          sql<number>`COUNT(*) FILTER (WHERE NOT (${isPaid}) AND ${isOverdue})`.mapWith(
            Number,
          ),
      })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, context.companyId),
          eq(documents.documentType, "invoice"),
          eq(documents.status, "issued"),
          isNull(documents.deletedAt),
          query.from ? gte(documents.issueDate, query.from) : undefined,
          query.to ? lte(documents.issueDate, query.to) : undefined,
        ),
      );

    const totals = row ?? {
      paidTotal: 0,
      pendingTotal: 0,
      overdueTotal: 0,
      pendingCount: 0,
      partialCount: 0,
      paidCount: 0,
      overdueCount: 0,
    };

    return withRequestId(
      Response.json({
        paid_cents: totals.paidTotal,
        pending_cents: totals.pendingTotal,
        overdue_cents: totals.overdueTotal,
        counts_by_status: {
          pending: totals.pendingCount,
          partial: totals.partialCount,
          paid: totals.paidCount,
          overdue: totals.overdueCount,
        },
      }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
