import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-share-email-contract-secret-at-least-32";
process.env.BETTER_AUTH_URL = appBaseUrl;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { POST: createShareLink, DELETE: disableShareLink } = await import(
  "@/app/api/v1/documents/[id]/share-link/route"
);
const { POST: sendDocumentEmail } = await import(
  "@/app/api/v1/documents/[id]/email/route"
);
const { GET: getEmailDeliveries } = await import(
  "@/app/api/v1/documents/[id]/email-deliveries/route"
);

interface TenantFixture {
  userId: string;
  companyId: string;
  cookie: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function jsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new Error("La respuesta debe ser un objeto JSON.");
  }
  return body;
}

function authenticatedRequest(
  tenant: TenantFixture,
  path: string,
  options: RequestInit = {},
): Request {
  const headers = new Headers(options.headers);
  headers.set("Cookie", tenant.cookie);
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`${appBaseUrl}${path}`, { ...options, headers });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(
    /(?:__Secure-)?better-auth\.session_token=[^;,]+/,
  );
  if (!match) {
    throw new Error("Better Auth no ha devuelto la cookie de sesión.");
  }
  return match[0];
}

async function createTenant(plan: "free" | "pro"): Promise<TenantFixture> {
  const suffix = crypto.randomUUID();
  const email = `share-email-contract-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Share Email Contract",
        email,
        password: "contract-password-123",
      }),
    }),
  );
  expect(signUpResponse.status).toBe(200);

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    throw new Error("No se ha creado el usuario de contrato.");
  }

  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, user.id));
  const signInResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "contract-password-123" }),
    }),
  );
  expect(signInResponse.status).toBe(200);

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId: user.id,
    legalName: "Empresa Compartir, S.L.",
    taxId: "B12345678",
    address: "Calle de Compartir 1, Madrid",
    email,
    plan,
    createdAt: now,
    updatedAt: now,
  });

  return { userId: user.id, companyId, cookie: sessionCookie(signInResponse) };
}

async function seedDocument(
  tenant: TenantFixture,
  overrides: { status: "draft" | "issued" | "voided"; number?: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    status: overrides.status,
    number: overrides.status === "draft" ? undefined : (overrides.number ?? 1),
    fullNumber:
      overrides.status === "draft"
        ? undefined
        : `2026-${(overrides.number ?? 1).toString().padStart(4, "0")}`,
    issueDate: now.toISOString().slice(0, 10),
    totalCents: 10_000,
    pdfStatus: overrides.status === "draft" ? undefined : "ready",
    issuedAt: overrides.status === "draft" ? undefined : now,
    issuerSnapshot:
      overrides.status === "draft"
        ? undefined
        : { legalName: "Empresa Compartir, S.L." },
    clientSnapshot:
      overrides.status === "draft" ? undefined : { name: "Cliente" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await jsonRecord(response)).toEqual({
    error: {
      code: "resource_not_found",
      message: "No se ha encontrado el recurso solicitado.",
    },
  });
}

describe("share link and document email HTTP contract", () => {
  let proTenant: TenantFixture;
  let freeTenant: TenantFixture;

  beforeEach(async () => {
    cloudflareState.env = {
      EMAIL_SEND_QUEUE: { send: () => Promise.resolve() },
    };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    proTenant = await createTenant("pro");
    freeTenant = await createTenant("free");
  });

  it("creates a share link with an opaque token url and reuses it on repeat calls", async () => {
    const documentId = await seedDocument(proTenant, { status: "issued" });

    const firstResponse = await createShareLink(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/share-link`,
        { method: "POST" },
      ),
      routeContext(documentId),
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await jsonRecord(firstResponse);
    expect(firstBody.url).toContain(`/d/${firstBody.token}`);

    const secondResponse = await createShareLink(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/share-link`,
        { method: "POST" },
      ),
      routeContext(documentId),
    );
    const secondBody = await jsonRecord(secondResponse);
    expect(secondBody.token).toBe(firstBody.token);
  });

  it("rejects sharing a draft document", async () => {
    const documentId = await seedDocument(proTenant, { status: "draft" });
    const response = await createShareLink(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/share-link`,
        { method: "POST" },
      ),
      routeContext(documentId),
    );
    expect(response.status).toBe(409);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "conflict",
    });
  });

  it("disables an active share link", async () => {
    const documentId = await seedDocument(proTenant, { status: "issued" });
    await createShareLink(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/share-link`,
        { method: "POST" },
      ),
      routeContext(documentId),
    );
    const disableResponse = await disableShareLink(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/share-link`,
        { method: "DELETE" },
      ),
      routeContext(documentId),
    );
    expect(disableResponse.status).toBe(200);
    expect((await jsonRecord(disableResponse)).disabled_at).not.toBeNull();
  });

  it("requires an Idempotency-Key header to send a document by email", async () => {
    const documentId = await seedDocument(proTenant, { status: "issued" });
    const response = await sendDocumentEmail(
      authenticatedRequest(proTenant, `/api/v1/documents/${documentId}/email`, {
        method: "POST",
        body: JSON.stringify({ recipient_email: "cliente@example.test" }),
      }),
      routeContext(documentId),
    );
    expect(response.status).toBe(400);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "idempotency_key_invalid",
    });
  });

  it("accepts a pro-plan email request and lists it in the paginated delivery history", async () => {
    const documentId = await seedDocument(proTenant, { status: "issued" });
    const response = await sendDocumentEmail(
      authenticatedRequest(proTenant, `/api/v1/documents/${documentId}/email`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ recipient_email: "cliente@example.test" }),
      }),
      routeContext(documentId),
    );
    expect(response.status).toBe(202);
    const body = await jsonRecord(response);
    expect(body.delivery_id).toEqual(expect.any(String));

    const historyResponse = await getEmailDeliveries(
      authenticatedRequest(
        proTenant,
        `/api/v1/documents/${documentId}/email-deliveries`,
      ),
      routeContext(documentId),
    );
    expect(historyResponse.status).toBe(200);
    const historyBody = await jsonRecord(historyResponse);
    const items = historyBody.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("recipient_email");
    expect(items[0]).toMatchObject({ id: body.delivery_id });
  });

  it("rejects a free-plan email request as a feature not in plan, with alternatives", async () => {
    const documentId = await seedDocument(freeTenant, { status: "issued" });
    const response = await sendDocumentEmail(
      authenticatedRequest(
        freeTenant,
        `/api/v1/documents/${documentId}/email`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ recipient_email: "cliente@example.test" }),
        },
      ),
      routeContext(documentId),
    );
    expect(response.status).toBe(403);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "feature_not_in_plan",
    });
  });

  it("returns 404 for share-link and email operations on a foreign document", async () => {
    const foreignDocumentId = await seedDocument(freeTenant, {
      status: "issued",
    });

    const responses = await Promise.all([
      createShareLink(
        authenticatedRequest(
          proTenant,
          `/api/v1/documents/${foreignDocumentId}/share-link`,
          { method: "POST" },
        ),
        routeContext(foreignDocumentId),
      ),
      disableShareLink(
        authenticatedRequest(
          proTenant,
          `/api/v1/documents/${foreignDocumentId}/share-link`,
          { method: "DELETE" },
        ),
        routeContext(foreignDocumentId),
      ),
      sendDocumentEmail(
        authenticatedRequest(
          proTenant,
          `/api/v1/documents/${foreignDocumentId}/email`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ recipient_email: "cliente@example.test" }),
          },
        ),
        routeContext(foreignDocumentId),
      ),
      getEmailDeliveries(
        authenticatedRequest(
          proTenant,
          `/api/v1/documents/${foreignDocumentId}/email-deliveries`,
        ),
        routeContext(foreignDocumentId),
      ),
    ]);

    for (const response of responses) {
      await expectNotFound(response);
    }
  });
});
