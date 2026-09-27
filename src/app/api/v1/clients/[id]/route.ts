import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { clients } from "@/db/schema/client";
import { documents } from "@/db/schema/document";
import { payments } from "@/db/schema/payment";
import { apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parseJson, validate } from "@/lib/api/validate";
import { logSafe } from "@/lib/log";
import {
  ResourceNotFoundError,
  resolveCompanyContext,
} from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SPANISH_TAX_ID_PATTERN =
  /^(?:[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$/;
const PHONE_CHARACTERS_PATTERN = /^\+?[0-9() .-]+$/;

const routeParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

function optionalTextSchema(fieldLabel: string, maximumLength: number) {
  return z
    .union([
      z.null(),
      z.literal(""),
      z
        .string()
        .trim()
        .min(1)
        .max(
          maximumLength,
          `${fieldLabel} no puede superar ${maximumLength} caracteres.`,
        ),
    ])
    .transform((value) => (value === "" ? null : value))
    .optional();
}

const taxIdSchema = z
  .union([
    z.null(),
    z.literal(""),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        SPANISH_TAX_ID_PATTERN,
        "Introduce un NIF, NIE o CIF español válido, sin espacios ni guiones.",
      ),
  ])
  .transform((value) => (value === "" ? null : value))
  .optional();

const emailSchema = z
  .union([
    z.null(),
    z.literal(""),
    z
      .string()
      .trim()
      .max(320, "El correo no puede superar 320 caracteres.")
      .email("Introduce un correo electrónico válido."),
  ])
  .transform((value) => (value === "" ? null : value))
  .optional();

const phoneSchema = z
  .union([
    z.null(),
    z.literal(""),
    z
      .string()
      .trim()
      .min(1)
      .max(50, "El teléfono no puede superar 50 caracteres.")
      .refine(
        (value) => PHONE_CHARACTERS_PATTERN.test(value),
        "El teléfono solo puede contener números, espacios, +, guiones y paréntesis.",
      )
      .refine((value) => {
        const digitCount = value.replaceAll(/\D/gu, "").length;
        return digitCount >= 7 && digitCount <= 15;
      }, "Introduce un teléfono válido de entre 7 y 15 dígitos."),
  ])
  .transform((value) => (value === "" ? null : value))
  .optional();

const updateClientSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Indica el nombre o la razón social del cliente.")
      .max(200, "El nombre no puede superar 200 caracteres.")
      .optional(),
    tax_id: taxIdSchema,
    email: emailSchema,
    phone: phoneSchema,
    address: optionalTextSchema("La dirección", 500),
    notes: optionalTextSchema("Las notas", 5_000),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "Indica al menos un dato para actualizar.",
    },
  );

type ClientRow = typeof clients.$inferSelect;
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
    logSafe("error", "clients.detail_route_failed", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return withRequestId(
    apiErrorResponse(apiError, propagatedRequestId),
    requestId,
  );
}

function clientResponse(
  client: ClientRow,
  aggregates: { pendingCents: number; overdueCents: number },
) {
  return {
    id: client.id,
    name: client.name,
    tax_id: client.taxId,
    address: client.address,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
    archived_at: client.archivedAt,
    pending_cents: aggregates.pendingCents,
    overdue_cents: aggregates.overdueCents,
  };
}

/**
 * Mirrors the derivation used by the dashboard aggregate (see
 * `src/app/api/v1/dashboard/route.ts`), scoped to a single client. Drizzle
 * only fully qualifies `${documents.clientId}` when this fragment is nested
 * inside another `sql` template, so every usage wraps it one level deep.
 */
async function loadReceivableAggregates(
  database: ReturnType<typeof createDatabase>,
  companyId: string,
  clientId: string,
): Promise<{ pendingCents: number; overdueCents: number }> {
  const paidCentsRaw = sql`COALESCE((
    SELECT SUM(scoped_payment.amount_cents)
    FROM ${payments} scoped_payment
    WHERE scoped_payment.document_id = ${documents.id}
      AND scoped_payment.company_id = ${companyId}
  ), 0)`;
  const paidCents = sql<number>`${paidCentsRaw}`.mapWith(Number);
  const isOverdue = sql`(
    ${documents.dueDate} IS NOT NULL
    AND ${documents.dueDate} < (now() AT TIME ZONE 'Europe/Madrid')::date
  )`;
  const isPaid = sql`${paidCents} >= ${documents.totalCents}`;
  const outstanding = sql<number>`GREATEST(${documents.totalCents} - ${paidCents}, 0)`;

  const [row] = await database
    .select({
      pendingCents:
        sql<number>`COALESCE(SUM(CASE WHEN NOT (${isPaid}) AND NOT (${isOverdue}) THEN ${outstanding} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      overdueCents:
        sql<number>`COALESCE(SUM(CASE WHEN NOT (${isPaid}) AND ${isOverdue} THEN ${outstanding} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.clientId, clientId),
        eq(documents.documentType, "invoice"),
        eq(documents.status, "issued"),
        isNull(documents.deletedAt),
      ),
    );

  return row ?? { pendingCents: 0, overdueCents: 0 };
}

async function loadClient(
  database: ReturnType<typeof createDatabase>,
  companyId: string,
  clientId: string,
): Promise<ClientRow> {
  const [client] = await database
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);

  if (!client) {
    throw new ResourceNotFoundError();
  }
  return client;
}

export async function GET(
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
    const client = await loadClient(database, context.companyId, params.id);
    const aggregates = await loadReceivableAggregates(
      database,
      context.companyId,
      params.id,
    );

    return withRequestId(
      Response.json(clientResponse(client, aggregates)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
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
    const inputPromise = parseJson(request, updateClientSchema);
    const [context, params, input] = await Promise.all([
      contextPromise,
      paramsPromise,
      inputPromise,
    ]);
    const database = createDatabase();
    const [updatedClient] = await database
      .update(clients)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.tax_id === undefined ? {} : { taxId: input.tax_id }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clients.id, params.id),
          eq(clients.companyId, context.companyId),
        ),
      )
      .returning();

    if (!updatedClient) {
      throw new ResourceNotFoundError();
    }
    const aggregates = await loadReceivableAggregates(
      database,
      context.companyId,
      params.id,
    );

    return withRequestId(
      Response.json(clientResponse(updatedClient, aggregates)),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
