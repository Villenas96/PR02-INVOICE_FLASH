import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aiConfirmations,
  aiConnections,
  companies,
  documentEvents,
  documents,
} from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
  type Tenant,
} from "./http";
import {
  authorizeAndConsent,
  exchangeCode,
  pkce,
  registerClient,
} from "./mcp-helpers";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;
process.env.APP_BASE_URL = APP_BASE_URL;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler, MCP_RESOURCE } = await import(
  "@/lib/auth"
);
const mcpRoute = await import("@/app/api/mcp/route");
const aiList = await import("@/app/api/v1/ai-connections/route");
const aiOne = await import("@/app/api/v1/ai-connections/[id]/route");
const clientsRoute = await import("@/app/api/v1/clients/route");

let pdfQueue: ReturnType<typeof recordingQueue>;
let rateLimit: { success: boolean };

beforeEach(() => {
  pdfQueue = recordingQueue();
  rateLimit = { success: true };
  cloudflareState.env = {
    PDF_RENDER_QUEUE: pdfQueue,
    EMAIL_SEND_QUEUE: recordingQueue(),
    MCP_RATE_LIMITER: { limit: () => Promise.resolve(rateLimit) },
  };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

interface Connected {
  tenant: Tenant;
  clientId: string;
  token: string;
  connectionId: string;
}

async function connect(plan: "pro" | "essential" = "pro"): Promise<Connected> {
  // Connect while Pro (the gate), then optionally downgrade.
  const tenant = await createTenant(auth, database, "pro");
  const clientId = await registerClient(auth, "Asistente de prueba");
  const created = await aiList.POST(
    authenticatedRequest(tenant, "/api/v1/ai-connections", {
      method: "POST",
      body: JSON.stringify({ oauth_client_id: clientId }),
    }),
  );
  expect(created.status).toBe(201);
  const { id: connectionId } = (await created.json()) as { id: string };
  const { verifier, challenge } = pkce();
  const code = await authorizeAndConsent({
    auth,
    cookie: tenant.cookie,
    clientId,
    resource: MCP_RESOURCE,
    challenge,
  });
  const tokens = (await (
    await exchangeCode({
      auth,
      clientId,
      code,
      verifier,
      resource: MCP_RESOURCE,
    })
  ).json()) as { access_token: string };
  if (plan !== "pro") {
    await database
      .update(companies)
      .set({ plan })
      .where(eq(companies.id, tenant.companyId));
  }
  return { tenant, clientId, token: tokens.access_token, connectionId };
}

let rpcId = 0;
async function rpc(
  token: string | null,
  method: string,
  params?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  rpcId += 1;
  const response = await mcpRoute.POST(
    new Request(`${APP_BASE_URL}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function tool(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  // biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON-RPC payloads.
): Promise<{ isError: boolean; data: any; status: number }> {
  const { status, body } = await rpc(token, "tools/call", {
    name,
    arguments: args,
  });
  const result = body.result as
    | { isError?: boolean; content: Array<{ text: string }> }
    | undefined;
  if (!result) {
    return { isError: true, data: body, status };
  }
  const text = result.content[0]?.text ?? "null";
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // The SDK reports invalid tool arguments as plain text.
    data = { error: { code: "invalid_arguments", message: text } };
  }
  return { isError: result.isError === true, data, status };
}

const LINE = {
  description: "Diseño web",
  quantity: 1,
  unit_price_cents: 10_000,
  tax_rate: 21,
};

describe("authentication", () => {
  it("rejects a request without a token and advertises the metadata", async () => {
    const { status } = await rpc(null, "tools/list");
    expect(status).toBe(401);
  });

  it("lists the tools for a connected Pro assistant", async () => {
    const { token } = await connect();
    const { status, body } = await rpc(token, "tools/list");
    expect(status).toBe(200);
    const names = (
      (body.result as { tools: Array<{ name: string }> }).tools ?? []
    ).map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_clients",
        "get_client",
        "create_client",
        "search_products",
        "create_product",
        "list_documents",
        "get_document",
        "get_payment_summary",
        "create_draft",
        "update_draft",
        "send_document",
        "record_payment",
        "request_issue",
        "request_void",
        "confirm_action",
      ]),
    );
  });

  it("updates last_used_at", async () => {
    const { token, connectionId } = await connect();
    await tool(token, "search_clients");
    const [row] = await database
      .select({ lastUsedAt: aiConnections.lastUsedAt })
      .from(aiConnections)
      .where(eq(aiConnections.id, connectionId));
    expect(row?.lastUsedAt).toBeTruthy();
  });

  it("rejects at once after revocation", async () => {
    const { token, tenant, connectionId } = await connect();
    expect((await tool(token, "search_clients")).isError).toBe(false);
    const revoked = await aiOne.DELETE(
      authenticatedRequest(tenant, `/api/v1/ai-connections/${connectionId}`, {
        method: "DELETE",
      }),
      routeContext({ id: connectionId }),
    );
    expect(revoked.status).toBe(204);
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });

  it("rejects at once when the company drops from Pro", async () => {
    const { token, tenant } = await connect();
    expect((await rpc(token, "tools/list")).status).toBe(200);
    await database
      .update(companies)
      .set({ plan: "essential" })
      .where(eq(companies.id, tenant.companyId));
    expect((await rpc(token, "tools/list")).status).toBe(403);
    // Nothing was deleted: upgrading again restores access untouched.
    await database
      .update(companies)
      .set({ plan: "pro" })
      .where(eq(companies.id, tenant.companyId));
    expect((await rpc(token, "tools/list")).status).toBe(200);
  });

  it("rate-limits per connection", async () => {
    const { token } = await connect();
    rateLimit = { success: false };
    expect((await rpc(token, "tools/list")).status).toBe(429);
  });
});

describe("tools", () => {
  it("scopes to the company: another company's document is not found", async () => {
    const mine = await connect();
    const other = await createTenant(auth, database, "pro");
    const foreignId = crypto.randomUUID();
    await database.insert(documents).values({
      id: foreignId,
      companyId: other.companyId,
      documentType: "invoice",
      status: "draft",
      issueDate: "2026-10-01",
      subtotalCents: 0,
      taxBreakdown: [],
      totalCents: 0,
    });
    const result = await tool(mine.token, "get_document", {
      document_id: foreignId,
    });
    expect(result.isError).toBe(true);
    const listing = await tool(mine.token, "list_documents");
    expect(listing.data.items).toEqual([]);
  });

  it("returns options for an ambiguous client and never picks one", async () => {
    const { token, tenant } = await connect();
    await clientsRoute.POST(
      authenticatedRequest(tenant, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({
          name: "Cliente de contrato Norte, S.L.",
          tax_id: "B11111111",
          address: "Calle Norte 1",
        }),
      }),
    );
    const ambiguous = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_query: "Cliente de contrato",
      lines: [LINE],
    });
    expect(ambiguous.isError).toBe(false);
    expect(ambiguous.data.status).toBe("needs_choice");
    expect(ambiguous.data.options).toHaveLength(2);
    expect(
      await database
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.companyId, tenant.companyId)),
    ).toEqual([]);

    const missing = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_query: "Inexistente",
      lines: [LINE],
    });
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe("client_not_found");

    const unique = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_query: "Norte",
      lines: [LINE],
    });
    expect(unique.isError).toBe(false);
    expect(unique.data.status).toBe("draft");
  });

  it("applies the same validation as the API", async () => {
    const { token, tenant } = await connect();
    const invalid = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [{ ...LINE, unit_price_cents: -5 }],
    });
    expect(invalid.isError).toBe(true);
  });

  it("request_issue does not issue; confirm_action issues once with the AI actor", async () => {
    const { token, tenant, connectionId } = await connect();
    const draft = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [LINE],
    });
    expect(draft.isError, JSON.stringify(draft.data)).toBe(false);
    const documentId = draft.data.id as string;

    const requested = await tool(token, "request_issue", {
      document_id: documentId,
    });
    expect(requested.data.status).toBe("confirmation_required");
    expect(requested.data.summary.will_reserve_number).toBe(true);
    const confirmationToken = requested.data.confirmation_token as string;
    const [stillDraft] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(stillDraft).toMatchObject({ status: "draft", number: null });
    expect(pdfQueue.messages).toEqual([]);

    const confirmed = await tool(token, "confirm_action", {
      confirmation_token: confirmationToken,
    });
    expect(confirmed.isError, JSON.stringify(confirmed.data)).toBe(false);
    const [issued] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(issued?.status).toBe("issued");
    expect(issued?.number).toBe(1);

    const events = await database
      .select({ actor: documentEvents.actor, event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, documentId));
    const issuedEvent = events.find((entry) => entry.event === "issued");
    expect(issuedEvent?.actor).toBe(`ai:${connectionId}:user:${tenant.userId}`);

    // Single use: the same token cannot issue (or do anything) again.
    const again = await tool(token, "confirm_action", {
      confirmation_token: confirmationToken,
    });
    expect(again.isError).toBe(true);
    expect(again.data.error.code).toBe("confirmation_expired");
    const [afterwards] = await database
      .select({ number: documents.number })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(afterwards?.number).toBe(1);
  });

  it("a confirmation token expires after five minutes", async () => {
    const { token, tenant } = await connect();
    const draft = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [LINE],
    });
    const requested = await tool(token, "request_issue", {
      document_id: draft.data.id,
    });
    await database
      .update(aiConfirmations)
      .set({ expiresAt: new Date(Date.now() - 1_000) });
    const result = await tool(token, "confirm_action", {
      confirmation_token: requested.data.confirmation_token,
    });
    expect(result.isError).toBe(true);
    const [row] = await database
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, draft.data.id as string));
    expect(row?.status).toBe("draft");
  });

  it("a confirmation token only works for the connection that requested it", async () => {
    const first = await connect();
    const second = await connect();
    const draft = await tool(first.token, "create_draft", {
      doc_type: "invoice",
      client_id: first.tenant.clientId,
      lines: [LINE],
    });
    const requested = await tool(first.token, "request_issue", {
      document_id: draft.data.id,
    });
    const stolen = await tool(second.token, "confirm_action", {
      confirmation_token: requested.data.confirmation_token,
    });
    expect(stolen.isError).toBe(true);
    const [row] = await database
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, draft.data.id as string));
    expect(row?.status).toBe("draft");
  });

  it("request_void and confirm_action void an issued invoice", async () => {
    const { token, tenant } = await connect();
    const draft = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [LINE],
    });
    const issue = await tool(token, "request_issue", {
      document_id: draft.data.id,
    });
    await tool(token, "confirm_action", {
      confirmation_token: issue.data.confirmation_token,
    });
    const voidRequest = await tool(token, "request_void", {
      document_id: draft.data.id,
    });
    expect(voidRequest.data.action).toBe("void");
    const [beforeVoid] = await database
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, draft.data.id as string));
    expect(beforeVoid?.status).toBe("issued");
    const voided = await tool(token, "confirm_action", {
      confirmation_token: voidRequest.data.confirmation_token,
    });
    expect(voided.isError, JSON.stringify(voided.data)).toBe(false);
    const [afterVoid] = await database
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, draft.data.id as string));
    expect(afterVoid?.status).toBe("voided");
  });

  it("records a payment and summarises the derived state", async () => {
    const { token, tenant } = await connect();
    const draft = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [LINE],
    });
    const issue = await tool(token, "request_issue", {
      document_id: draft.data.id,
    });
    await tool(token, "confirm_action", {
      confirmation_token: issue.data.confirmation_token,
    });
    const payment = await tool(token, "record_payment", {
      document_id: draft.data.id,
      amount_cents: 5_000,
      paid_on: "2026-10-20",
      method: "transfer",
    });
    expect(payment.isError, JSON.stringify(payment.data)).toBe(false);
    const summary = await tool(token, "get_payment_summary", {
      document_id: draft.data.id,
    });
    expect(summary.data).toMatchObject({
      total_cents: 12_100,
      paid_cents: 5_000,
      pending_cents: 7_100,
      payment_status: "partial",
    });
  });

  it("send_document follows the plan rules of the API", async () => {
    const { token, tenant } = await connect();
    await database
      .update(companies)
      .set({ plan: "pro" })
      .where(eq(companies.id, tenant.companyId));
    const draft = await tool(token, "create_draft", {
      doc_type: "invoice",
      client_id: tenant.clientId,
      lines: [LINE],
    });
    const sent = await tool(token, "send_document", {
      document_id: draft.data.id,
      recipient_email: "cliente@example.test",
    });
    // A draft cannot be sent: the API's own rule, surfaced as a tool error.
    expect(sent.isError).toBe(true);
  });
});
