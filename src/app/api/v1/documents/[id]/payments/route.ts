import { z } from "zod";

import { createDatabase } from "@/db";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";
import { createPayment, type PaymentRecord } from "@/services/payments";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const createPaymentSchema = z
  .object({
    amount_cents: z
      .number()
      .int("El importe debe ser un entero en céntimos.")
      .positive("El importe debe ser mayor que cero.")
      .max(MAX_POSTGRES_INTEGER),
    paid_on: z.iso.date(),
    method: z.enum(["transfer", "cash", "card", "other"]).nullable().optional(),
    confirmed_overpayment: z.boolean().optional().default(false),
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
    "payments.create_route_failed",
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

function paymentResponse(payment: PaymentRecord) {
  return {
    id: payment.id,
    document_id: payment.documentId,
    amount_cents: payment.amountCents,
    confirmed_overpayment: payment.confirmedOverpayment,
    paid_on: payment.paidOn,
    method: payment.method,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
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
    const inputPromise = parseJson(request, createPaymentSchema);
    const [context, params, input] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
    ]);
    const payment = await createPayment(
      {
        companyId: context.companyId,
        documentId: params.id,
        actor: context.userId,
        amountCents: input.amount_cents,
        paidOn: input.paid_on,
        method: input.method ?? null,
        confirmedOverpayment: input.confirmed_overpayment,
      },
      { database: createDatabase() },
    );

    return withRequestId(
      Response.json(paymentResponse(payment), { status: 201 }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
