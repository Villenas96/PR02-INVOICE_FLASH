import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clients, companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-client-snapshot-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");
const { PATCH: patchClient } = await import("@/app/api/v1/clients/[id]/route");
const { POST: archiveClient } = await import(
  "@/app/api/v1/clients/[id]/archive/route"
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
  const email = `client-snapshot-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Client Snapshot",
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
    legalName: "Empresa Instantánea, S.L.",
    taxId: "B12345678",
    address: "Calle de la Instantánea 1, Madrid",
    email,
    createdAt: now,
    updatedAt: now,
  });

  return { userId: user.id, companyId, cookie: sessionCookie(signInResponse) };
}

describe("client edits and archiving never mutate an issued document snapshot", () => {
  let owner: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
  });

  it("keeps the frozen client_snapshot after the client is renamed and archived", async () => {
    const clientId = crypto.randomUUID();
    await database.insert(clients).values({
      id: clientId,
      companyId: owner.companyId,
      name: "Cliente Original, S.L.",
      taxId: "A11111111",
      address: "Dirección original 1",
      email: "original@example.test",
    });

    const documentId = crypto.randomUUID();
    const now = new Date();
    const originalSnapshot = {
      name: "Cliente Original, S.L.",
      taxId: "A11111111",
      address: "Dirección original 1",
      email: "original@example.test",
      phone: null,
    };
    await database.insert(documents).values({
      id: documentId,
      companyId: owner.companyId,
      documentType: "invoice",
      status: "issued",
      number: 1,
      fullNumber: "2026-0001",
      clientId,
      issueDate: now.toISOString().slice(0, 10),
      totalCents: 12_100,
      pdfStatus: "ready",
      issuedAt: now,
      issuerSnapshot: { legalName: "Empresa Instantánea, S.L." },
      clientSnapshot: originalSnapshot,
      createdAt: now,
      updatedAt: now,
    });

    const patchResponse = await patchClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Cliente Editado, S.L.",
          tax_id: "B99999999",
          address: "Dirección editada 2",
          email: "editado@example.test",
        }),
      }),
      routeContext(clientId),
    );
    expect(patchResponse.status).toBe(200);
    expect(await jsonRecord(patchResponse)).toMatchObject({
      name: "Cliente Editado, S.L.",
    });

    const archiveResponse = await archiveClient(
      authenticatedRequest(owner, `/api/v1/clients/${clientId}/archive`, {
        method: "POST",
      }),
      routeContext(clientId),
    );
    expect(archiveResponse.status).toBe(200);

    const detailResponse = await getDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}`),
      routeContext(documentId),
    );
    expect(detailResponse.status).toBe(200);
    const detail = await jsonRecord(detailResponse);
    expect(detail.client_snapshot).toEqual(originalSnapshot);
    expect(detail.client_id).toBe(clientId);
  });
});
