import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-clients-contract-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getClients, POST: createClient } = await import(
  "@/app/api/v1/clients/route"
);
const { GET: getClient, PATCH: patchClient } = await import(
  "@/app/api/v1/clients/[id]/route"
);
const { GET: getClientDocuments } = await import(
  "@/app/api/v1/clients/[id]/documents/route"
);
const { POST: archiveClient } = await import(
  "@/app/api/v1/clients/[id]/archive/route"
);
const { POST: unarchiveClient } = await import(
  "@/app/api/v1/clients/[id]/unarchive/route"
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

async function createTenant(): Promise<TenantFixture> {
  const suffix = crypto.randomUUID();
  const email = `clients-contract-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Clients Contract",
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
    legalName: "Empresa Contrato, S.L.",
    taxId: "B12345678",
    address: "Calle del Contrato 1, Madrid",
    email,
    createdAt: now,
    updatedAt: now,
  });

  return { userId: user.id, companyId, cookie: sessionCookie(signInResponse) };
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

describe("clients HTTP contract", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
    foreignTenant = await createTenant();
  });

  it("rejects an invalid tax id with an actionable field error", async () => {
    const response = await createClient(
      authenticatedRequest(owner, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Cliente inválido", tax_id: "no-nif" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);
    expect(body.error).toMatchObject({ code: "validation_error" });
  });

  it("searches by name or tax id and filters archived clients", async () => {
    const active = await createClient(
      authenticatedRequest(owner, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Panadería Sol", tax_id: "B11111111" }),
      }),
    );
    const activeBody = await jsonRecord(active);
    const other = await createClient(
      authenticatedRequest(owner, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Ferretería Luna" }),
      }),
    );
    const otherBody = await jsonRecord(other);

    await archiveClient(
      authenticatedRequest(owner, `/api/v1/clients/${otherBody.id}/archive`, {
        method: "POST",
      }),
      routeContext(otherBody.id as string),
    );

    const searchResponse = await getClients(
      authenticatedRequest(owner, "/api/v1/clients?q=Sol"),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = await jsonRecord(searchResponse);
    expect(searchBody.items).toEqual([
      expect.objectContaining({ id: activeBody.id }),
    ]);

    const defaultResponse = await getClients(
      authenticatedRequest(owner, "/api/v1/clients"),
    );
    const defaultBody = await jsonRecord(defaultResponse);
    expect(
      (defaultBody.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([activeBody.id]);

    const archivedResponse = await getClients(
      authenticatedRequest(owner, "/api/v1/clients?archived=true"),
    );
    const archivedBody = await jsonRecord(archivedResponse);
    expect(
      (archivedBody.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([otherBody.id]);
  });

  it("returns client detail with receivable aggregates and paginated history", async () => {
    const created = await createClient(
      authenticatedRequest(owner, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Cliente con historial" }),
      }),
    );
    const client = await jsonRecord(created);
    const clientId = client.id as string;
    const now = new Date();
    await database.insert(documents).values([
      {
        id: crypto.randomUUID(),
        companyId: owner.companyId,
        documentType: "invoice",
        status: "issued",
        number: 1,
        fullNumber: "2026-0001",
        clientId,
        issueDate: now.toISOString().slice(0, 10),
        totalCents: 5_000,
        pdfStatus: "ready",
        issuedAt: now,
        issuerSnapshot: { legalName: "Empresa Contrato, S.L." },
        clientSnapshot: { name: "Cliente con historial" },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const detailResponse = await getClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}`),
      routeContext(clientId),
    );
    expect(detailResponse.status).toBe(200);
    expect(await jsonRecord(detailResponse)).toMatchObject({
      id: clientId,
      pending_cents: 5_000,
      overdue_cents: 0,
    });

    const historyResponse = await getClientDocuments(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}/documents`),
      routeContext(clientId),
    );
    expect(historyResponse.status).toBe(200);
    const historyBody = await jsonRecord(historyResponse);
    expect(historyBody.items).toHaveLength(1);
    expect(historyBody.next_cursor).toBeNull();
  });

  it("edits a client and toggles archive/unarchive reversibly", async () => {
    const created = await createClient(
      authenticatedRequest(owner, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Cliente editable" }),
      }),
    );
    const clientId = (await jsonRecord(created)).id as string;

    const patchResponse = await patchClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Cliente renombrado" }),
      }),
      routeContext(clientId),
    );
    expect(patchResponse.status).toBe(200);
    expect(await jsonRecord(patchResponse)).toMatchObject({
      name: "Cliente renombrado",
    });

    const archiveResponse = await archiveClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}/archive`, {
        method: "POST",
      }),
      routeContext(clientId),
    );
    expect(archiveResponse.status).toBe(200);
    expect((await jsonRecord(archiveResponse)).archived_at).not.toBeNull();

    const unarchiveResponse = await unarchiveClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}/unarchive`, {
        method: "POST",
      }),
      routeContext(clientId),
    );
    expect(unarchiveResponse.status).toBe(200);
    expect((await jsonRecord(unarchiveResponse)).archived_at).toBeNull();
  });

  it("returns 404 for every foreign client operation", async () => {
    const created = await createClient(
      authenticatedRequest(foreignTenant, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({ name: "Cliente ajeno" }),
      }),
    );
    const foreignClientId = (await jsonRecord(created)).id as string;

    const responses = await Promise.all([
      getClient(
        authenticatedRequest(owner, `/api/v1/clients/${foreignClientId}`),
        routeContext(foreignClientId),
      ),
      patchClient(
        authenticatedRequest(owner, `/api/v1/clients/${foreignClientId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: "Intento ajeno" }),
        }),
        routeContext(foreignClientId),
      ),
      getClientDocuments(
        authenticatedRequest(
          owner,
          `/api/v1/clients/${foreignClientId}/documents`,
        ),
        routeContext(foreignClientId),
      ),
      archiveClient(
        authenticatedRequest(
          owner,
          `/api/v1/clients/${foreignClientId}/archive`,
          { method: "POST" },
        ),
        routeContext(foreignClientId),
      ),
      unarchiveClient(
        authenticatedRequest(
          owner,
          `/api/v1/clients/${foreignClientId}/unarchive`,
          { method: "POST" },
        ),
        routeContext(foreignClientId),
      ),
    ]);

    for (const response of responses) {
      await expectNotFound(response);
    }
  });
});
