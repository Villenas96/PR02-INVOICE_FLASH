import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseIdempotencyKey } from "@/lib/api/idempotency";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import { getPlanCapabilities } from "@/lib/plan";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";
import { createOrReuseDocumentEmailDelivery } from "@/services/email/deliveries";
import { createEmailSendMessage } from "@/workers/messages";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
const emailDocumentSchema = z
  .object({
    recipient_email: z
      .string()
      .trim()
      .max(320, "El correo no puede superar 320 caracteres.")
      .email("Introduce un correo electrónico válido."),
    custom_message: z
      .string()
      .trim()
      .max(2_000, "El mensaje no puede superar 2.000 caracteres.")
      .nullable()
      .optional(),
  })
  .strict();

type RouteContext = {
  params: Promise<{ id: string }>;
};

interface EmailQueue {
  send(message: unknown): Promise<void>;
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
    "documents.email_route_failed",
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

async function emailQueue(): Promise<EmailQueue> {
  const cloudflare = await getCloudflareContext();
  const queue = (cloudflare.env as { EMAIL_SEND_QUEUE?: EmailQueue })
    .EMAIL_SEND_QUEUE;

  if (!queue) {
    throw new ApiError(
      "internal_error",
      500,
      "No se ha podido iniciar el envío del correo.",
    );
  }
  return queue;
}

function featureNotInPlanError(): ApiError {
  return new ApiError(
    "feature_not_in_plan",
    403,
    "El envío por correo solo está disponible en el plan de pago. Puedes copiar el enlace público o descargar el PDF.",
  );
}

export async function POST(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const idempotencyKey = parseIdempotencyKey(request, true);
    if (!idempotencyKey) {
      throw new ApiError(
        "idempotency_key_invalid",
        400,
        "La cabecera Idempotency-Key es obligatoria.",
      );
    }
    const contextPromise = resolveCompanyContext(request);
    const paramsPromise = routeContext.params.then((params) =>
      validate(routeParamsSchema, params),
    );
    const inputPromise = parseJson(request, emailDocumentSchema);
    const queuePromise = emailQueue();
    const [context, params, input, queue] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
      queuePromise,
    ]);
    const database = createDatabase();
    const [row] = await database
      .select({
        status: documents.status,
        deletedAt: documents.deletedAt,
        plan: companies.plan,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(
        and(
          eq(documents.id, params.id),
          eq(documents.companyId, context.companyId),
        ),
      )
      .limit(1);

    if (!row || row.deletedAt) {
      throw new ResourceNotFoundError();
    }
    if (row.status === "draft") {
      throw new ApiError(
        "conflict",
        409,
        "Emite el documento antes de enviarlo por correo.",
      );
    }
    if (!getPlanCapabilities(row.plan).canSendEmail) {
      throw featureNotInPlanError();
    }

    const delivery = await createOrReuseDocumentEmailDelivery({
      database,
      companyId: context.companyId,
      documentId: params.id,
      requestedBy: context.userId,
      recipientEmail: input.recipient_email,
      customMessage: input.custom_message ?? null,
      idempotencyKey,
    });

    // Always publish: the consumer's atomic claim (`queued|failed → sending`)
    // makes a repeated message for an already `sending`/`sent` delivery a
    // safe no-op, mirroring the auth email delivery flow.
    await queue.send(createEmailSendMessage(delivery.id));

    return withRequestId(
      Response.json(
        { delivery_id: delivery.id, status: delivery.status },
        { status: 202 },
      ),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
