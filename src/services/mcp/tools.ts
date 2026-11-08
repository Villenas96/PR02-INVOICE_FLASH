import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import * as catalogItemsRoute from "@/app/api/v1/catalog-items/route";
import * as clientRoute from "@/app/api/v1/clients/[id]/route";
import * as clientsRoute from "@/app/api/v1/clients/route";
import * as emailRoute from "@/app/api/v1/documents/[id]/email/route";
import * as issueRoute from "@/app/api/v1/documents/[id]/issue/route";
import * as paymentsRoute from "@/app/api/v1/documents/[id]/payments/route";
import * as documentRoute from "@/app/api/v1/documents/[id]/route";
import * as voidRoute from "@/app/api/v1/documents/[id]/void/route";
import * as documentsRoute from "@/app/api/v1/documents/route";
import { ApiError, toApiError } from "@/lib/api/errors";
import {
  requestConfirmation,
  spendConfirmation,
} from "@/services/mcp/confirmations";
import type { McpPrincipal } from "@/services/mcp/connections";
import { type ApiResult, callApi } from "@/services/mcp/dispatch";

type Handler = Parameters<typeof callApi>[0]["handler"];

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function result(body: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    ...(isError ? { isError: true } : {}),
  };
}

function fromApi({ status, body }: ApiResult): ToolResult {
  return result(body, status >= 400);
}

const uuid = z.string().uuid();
const pagination = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
};

const line = z
  .object({
    description: z.string().describe("Texto de la línea"),
    quantity: z.union([z.string(), z.number()]).describe("Cantidad"),
    unit_price_cents: z
      .number()
      .int()
      .describe("Precio unitario en céntimos de euro (10,50 € = 1050)"),
    tax_rate: z
      .union([z.string(), z.number()])
      .describe("Porcentaje de IVA, p. ej. 21"),
    discount_pct: z.union([z.string(), z.number()]).optional(),
    tax_name: z.string().optional(),
    unit: z.string().nullable().optional(),
    catalog_item_id: uuid.nullable().optional(),
  })
  .strict();

const draftFields = {
  client_id: uuid
    .optional()
    .describe("Id del cliente; o usa client_query para buscarlo por nombre"),
  client_query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Nombre, NIF o correo del cliente. Si hay varios, se devuelven opciones",
    ),
  issue_date: z.string().optional().describe("AAAA-MM-DD"),
  due_date: z.string().nullable().optional().describe("AAAA-MM-DD"),
  notes: z.string().nullable().optional(),
  lines: z.array(line).min(1).max(500),
};

interface ClientOption {
  id: string;
  name: string;
  tax_id: string | null;
}

/**
 * Resolves `client_query` without ever guessing: one match is used, several
 * are returned as options for the person to choose (Edge Cases).
 */
async function resolveClient(
  principal: McpPrincipal,
  input: { client_id?: string; client_query?: string },
): Promise<
  | { kind: "resolved"; clientId: string | undefined }
  | { kind: "answer"; result: ToolResult }
> {
  if (input.client_id || !input.client_query) {
    return { kind: "resolved", clientId: input.client_id };
  }
  const found = await callApi({
    principal,
    handler: clientsRoute.GET as Handler,
    method: "GET",
    path: "/api/v1/clients",
    query: { q: input.client_query, limit: 6 },
  });
  if (found.status >= 400) {
    return { kind: "answer", result: fromApi(found) };
  }
  const items = (found.body as { items: ClientOption[] }).items;
  if (items.length === 0) {
    return {
      kind: "answer",
      result: result(
        {
          error: {
            code: "client_not_found",
            message: `No hay ningún cliente que coincida con «${input.client_query}». Créalo con create_client.`,
          },
        },
        true,
      ),
    };
  }
  if (items.length > 1) {
    return {
      kind: "answer",
      result: result({
        status: "needs_choice",
        message:
          "Hay varios clientes que coinciden. Pregunta a la persona cuál es y vuelve a llamar con client_id.",
        options: items.map((client) => ({
          id: client.id,
          name: client.name,
          tax_id: client.tax_id,
        })),
      }),
    };
  }
  return { kind: "resolved", clientId: items[0]?.id };
}

function withoutQuery<T extends { client_query?: string }>(input: T) {
  const { client_query: _ignored, ...rest } = input;
  return rest;
}

/**
 * MCP tools: thin adapters over the app's own route handlers (FR-055).
 * `request_issue`/`request_void` never act; only `confirm_action` does.
 */
export function registerTools(server: McpServer, principal: McpPrincipal) {
  const api = (
    handler: unknown,
    method: "GET" | "POST" | "PATCH",
    path: string,
    extra: {
      query?: Record<string, string | number | boolean | undefined>;
      params?: Record<string, string>;
      body?: unknown;
    } = {},
  ) =>
    callApi({
      principal,
      handler: handler as Handler,
      method,
      path,
      ...extra,
    });

  server.registerTool(
    "search_clients",
    {
      description:
        "Busca clientes por nombre, NIF o correo. Devuelve una lista paginada.",
      inputSchema: { query: z.string().optional(), ...pagination },
    },
    async ({ query, limit, cursor }) =>
      fromApi(
        await api(clientsRoute.GET, "GET", "/api/v1/clients", {
          query: { q: query, limit, cursor },
        }),
      ),
  );

  server.registerTool(
    "get_client",
    {
      description: "Devuelve los datos de un cliente.",
      inputSchema: { client_id: uuid },
    },
    async ({ client_id }) =>
      fromApi(
        await api(clientRoute.GET, "GET", `/api/v1/clients/${client_id}`, {
          params: { id: client_id },
        }),
      ),
  );

  server.registerTool(
    "create_client",
    {
      description:
        "Crea un cliente. Para facturas hacen falta NIF y dirección del cliente.",
      inputSchema: {
        name: z.string(),
        tax_id: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        postal_code: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async (input) =>
      fromApi(
        await api(clientsRoute.POST, "POST", "/api/v1/clients", {
          body: input,
        }),
      ),
  );

  server.registerTool(
    "search_products",
    {
      description: "Busca productos o servicios del catálogo.",
      inputSchema: { query: z.string().optional(), ...pagination },
    },
    async ({ query, limit, cursor }) =>
      fromApi(
        await api(catalogItemsRoute.GET, "GET", "/api/v1/catalog-items", {
          query: { q: query, limit, cursor },
        }),
      ),
  );

  server.registerTool(
    "create_product",
    {
      description: "Añade un producto o servicio al catálogo.",
      inputSchema: {
        description: z.string(),
        unit_price_cents: z.number().int(),
        tax_rate: z.union([z.string(), z.number()]).optional(),
        unit: z.string().nullable().optional(),
      },
    },
    async (input) =>
      fromApi(
        await api(catalogItemsRoute.POST, "POST", "/api/v1/catalog-items", {
          body: input,
        }),
      ),
  );

  server.registerTool(
    "list_documents",
    {
      description:
        "Lista documentos (facturas, proformas, presupuestos, albaranes) con filtros. Los estados de cobro se calculan al consultar.",
      inputSchema: {
        type: z
          .enum(["invoice", "proforma", "receipt", "quote", "delivery_note"])
          .optional(),
        status: z.enum(["draft", "issued", "voided"]).optional(),
        payment_status: z
          .enum(["pending", "partial", "paid", "overdue"])
          .optional(),
        client_id: uuid.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        ...pagination,
      },
    },
    async (input) =>
      fromApi(
        await api(documentsRoute.GET, "GET", "/api/v1/documents", {
          query: input,
        }),
      ),
  );

  server.registerTool(
    "get_document",
    {
      description: "Devuelve un documento con sus líneas y totales.",
      inputSchema: { document_id: uuid },
    },
    async ({ document_id }) =>
      fromApi(
        await api(
          documentRoute.GET,
          "GET",
          `/api/v1/documents/${document_id}`,
          { params: { id: document_id } },
        ),
      ),
  );

  server.registerTool(
    "get_payment_summary",
    {
      description:
        "Resume el cobro de una factura: total, cobrado, pendiente y estado (derivado).",
      inputSchema: { document_id: uuid },
    },
    async ({ document_id }) => {
      const response = await api(
        documentRoute.GET,
        "GET",
        `/api/v1/documents/${document_id}`,
        { params: { id: document_id } },
      );
      if (response.status >= 400) {
        return fromApi(response);
      }
      const document = response.body as Record<string, unknown>;
      return result({
        document_id,
        full_number: document.full_number,
        total_cents: document.total_cents,
        paid_cents: document.paid_cents,
        pending_cents:
          typeof document.total_cents === "number" &&
          typeof document.paid_cents === "number"
            ? Math.max(document.total_cents - document.paid_cents, 0)
            : null,
        payment_status: document.payment_status,
        due_date: document.due_date,
      });
    },
  );

  server.registerTool(
    "create_draft",
    {
      description:
        "Crea un borrador (no emite nada ni reserva número). Para emitirlo usa request_issue y después confirm_action.",
      inputSchema: {
        doc_type: z.enum(["invoice", "proforma", "quote", "delivery_note"]),
        ...draftFields,
      },
    },
    async (input) => {
      const client = await resolveClient(principal, input);
      if (client.kind === "answer") {
        return client.result;
      }
      return fromApi(
        await api(documentsRoute.POST, "POST", "/api/v1/documents", {
          body: { ...withoutQuery(input), client_id: client.clientId },
        }),
      );
    },
  );

  server.registerTool(
    "update_draft",
    {
      description:
        "Modifica un borrador. Los documentos emitidos no se pueden cambiar.",
      inputSchema: {
        document_id: uuid,
        ...Object.fromEntries(
          Object.entries(draftFields).map(([key, schema]) => [
            key,
            key === "lines" ? z.array(line).max(500).optional() : schema,
          ]),
        ),
      },
    },
    async ({ document_id, ...rest }) => {
      const client = await resolveClient(principal, rest);
      if (client.kind === "answer") {
        return client.result;
      }
      return fromApi(
        await api(
          documentRoute.PATCH,
          "PATCH",
          `/api/v1/documents/${document_id}`,
          {
            params: { id: document_id },
            body: {
              ...withoutQuery(rest),
              ...(client.clientId ? { client_id: client.clientId } : {}),
            },
          },
        ),
      );
    },
  );

  server.registerTool(
    "send_document",
    {
      description:
        "Envía por correo un documento emitido (plan Esencial o superior).",
      inputSchema: {
        document_id: uuid,
        recipient_email: z.string(),
        custom_message: z.string().nullable().optional(),
      },
    },
    async ({ document_id, ...body }) =>
      fromApi(
        await api(
          emailRoute.POST,
          "POST",
          `/api/v1/documents/${document_id}/email`,
          { params: { id: document_id }, body },
        ),
      ),
  );

  server.registerTool(
    "record_payment",
    {
      description:
        "Registra un cobro sobre una factura emitida. Un cobro por encima del pendiente exige confirmed_overpayment.",
      inputSchema: {
        document_id: uuid,
        amount_cents: z.number().int().positive(),
        paid_on: z.string().describe("AAAA-MM-DD"),
        method: z.enum(["transfer", "cash", "card", "other"]).optional(),
        confirmed_overpayment: z.boolean().optional(),
      },
    },
    async ({ document_id, ...body }) =>
      fromApi(
        await api(
          paymentsRoute.POST,
          "POST",
          `/api/v1/documents/${document_id}/payments`,
          { params: { id: document_id }, body },
        ),
      ),
  );

  async function request(
    action: "issue" | "void",
    documentId: string,
  ): Promise<ToolResult> {
    try {
      const confirmation = await requestConfirmation({
        principal,
        action,
        documentId,
      });
      return result({
        status: "confirmation_required",
        message:
          action === "issue"
            ? "No se ha emitido nada. Enseña este resumen a la persona; si lo aprueba, llama a confirm_action con el token. Al emitir se reserva el número definitivo y el documento ya no se podrá modificar."
            : "No se ha anulado nada. Enseña este resumen a la persona; si lo aprueba, llama a confirm_action con el token. Anular no se puede deshacer.",
        action,
        summary: {
          document_id: confirmation.summary.documentId,
          document_type: confirmation.summary.documentType,
          number: confirmation.summary.number,
          client: confirmation.summary.clientName,
          total_cents: confirmation.summary.totalCents,
          will_reserve_number: confirmation.summary.willReserveNumber,
        },
        confirmation_token: confirmation.confirmationToken,
        expires_at: confirmation.expiresAt.toISOString(),
      });
    } catch (error) {
      const apiError = toApiError(error);
      return result(
        { error: { code: apiError.code, message: apiError.message } },
        true,
      );
    }
  }

  server.registerTool(
    "request_issue",
    {
      description:
        "Paso 1 para emitir un borrador: NO emite. Devuelve un resumen y un confirmation_token de un solo uso (5 min).",
      inputSchema: { document_id: uuid },
    },
    async ({ document_id }) => request("issue", document_id),
  );

  server.registerTool(
    "request_void",
    {
      description:
        "Paso 1 para anular un documento emitido: NO anula. Devuelve un resumen y un confirmation_token de un solo uso (5 min).",
      inputSchema: { document_id: uuid },
    },
    async ({ document_id }) => request("void", document_id),
  );

  server.registerTool(
    "confirm_action",
    {
      description:
        "Paso 2: ejecuta la emisión o anulación que la persona ha aprobado. Solo con un confirmation_token vigente.",
      inputSchema: { confirmation_token: z.string().min(16).max(128) },
    },
    async ({ confirmation_token }) => {
      let spent: Awaited<ReturnType<typeof spendConfirmation>>;
      try {
        spent = await spendConfirmation({
          principal,
          token: confirmation_token,
        });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : toApiError(error);
        return result(
          { error: { code: apiError.code, message: apiError.message } },
          true,
        );
      }
      const outcome = await api(
        spent.action === "issue" ? issueRoute.POST : voidRoute.POST,
        "POST",
        `/api/v1/documents/${spent.documentId}/${spent.action}`,
        { params: { id: spent.documentId } },
      );
      return fromApi(outcome);
    },
  );
}
