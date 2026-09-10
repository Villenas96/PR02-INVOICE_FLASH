import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { createDatabase } from "@/db/index";
import { clients } from "@/db/schema/client";
import { ApiError, apiErrorResponse, toApiError } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/pagination";
import { parseJson, validate } from "@/lib/api/validate";
import { createUuidV7 } from "@/lib/ids";
import { logSafe } from "@/lib/log";
import { resolveCompanyContext } from "@/services/context";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SPANISH_TAX_ID_PATTERN =
  /^(?:[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])$/;
const PHONE_CHARACTERS_PATTERN = /^\+?[0-9() .-]+$/;

const paginationQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    v: z.literal(1),
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

const createClientSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Indica el nombre o la razón social del cliente.")
      .max(200, "El nombre no puede superar 200 caracteres."),
    tax_id: taxIdSchema,
    email: emailSchema,
    phone: phoneSchema,
    address: optionalTextSchema("La dirección", 500),
    notes: optionalTextSchema("Las notas", 5_000),
  })
  .strict();

type ClientRow = typeof clients.$inferSelect;

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

function clientResponse(client: ClientRow) {
  return {
    id: client.id,
    name: client.name,
    tax_id: client.taxId,
    address: client.address,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
  };
}

function routeErrorResponse(
  error: unknown,
  requestId: string,
  propagatedRequestId?: string,
): Response {
  const apiError = toApiError(error);

  if (apiError.status >= 500) {
    logSafe("error", "clients.route_failed", {
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

export async function GET(request: Request): Promise<Response> {
  const { requestId, propagatedRequestId } = requestIdFrom(request);

  try {
    const searchParams = new URL(request.url).searchParams;
    validate(paginationQuerySchema, Object.fromEntries(searchParams.entries()));
    const pagination = parsePagination(searchParams);
    const cursorId = decodeCursor(pagination.cursor);
    const context = await resolveCompanyContext(request);
    const database = createDatabase();

    const rows = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.companyId, context.companyId),
          isNull(clients.archivedAt),
          cursorId ? gt(clients.id, cursorId) : undefined,
        ),
      )
      .orderBy(asc(clients.id))
      .limit(pagination.limit + 1);
    const hasNextPage = rows.length > pagination.limit;
    const items = rows.slice(0, pagination.limit);
    const lastItem = items.at(-1);

    return withRequestId(
      Response.json({
        items: items.map(clientResponse),
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
    const inputPromise = parseJson(request, createClientSchema);
    const [context, input] = await Promise.all([contextPromise, inputPromise]);
    const database = createDatabase();
    const [createdClient] = await database
      .insert(clients)
      .values({
        id: createUuidV7(),
        companyId: context.companyId,
        name: input.name,
        taxId: input.tax_id,
        address: input.address,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
      })
      .returning();

    if (!createdClient) {
      throw new Error("Client insert returned no row.");
    }

    return withRequestId(
      Response.json(clientResponse(createdClient), { status: 201 }),
      requestId,
    );
  } catch (error) {
    return routeErrorResponse(error, requestId, propagatedRequestId);
  }
}
