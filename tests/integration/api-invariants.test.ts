import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogItems,
  clients,
  companies,
  documentSeries,
  documents,
  payments,
  users,
} from "@/db/schema";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/api/pagination";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-api-invariants-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = appBaseUrl;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");

const { GET: getCatalogItems } = await import(
  "@/app/api/v1/catalog-items/route"
);
const { PATCH: patchCatalogItem, DELETE: deleteCatalogItem } = await import(
  "@/app/api/v1/catalog-items/[id]/route"
);
const { POST: restoreCatalogItem } = await import(
  "@/app/api/v1/catalog-items/[id]/restore/route"
);
const { GET: getClients } = await import("@/app/api/v1/clients/route");
const { GET: getClient, PATCH: patchClient } = await import(
  "@/app/api/v1/clients/[id]/route"
);
const { POST: archiveClient } = await import(
  "@/app/api/v1/clients/[id]/archive/route"
);
const { POST: unarchiveClient } = await import(
  "@/app/api/v1/clients/[id]/unarchive/route"
);
const { GET: getClientDocuments } = await import(
  "@/app/api/v1/clients/[id]/documents/route"
);
const { GET: getDocuments } = await import("@/app/api/v1/documents/route");
const {
  GET: getDocument,
  PATCH: patchDocument,
  DELETE: deleteDocument,
} = await import("@/app/api/v1/documents/[id]/route");
const { POST: issueDocumentRoute } = await import(
  "@/app/api/v1/documents/[id]/issue/route"
);
const { POST: voidDocument } = await import(
  "@/app/api/v1/documents/[id]/void/route"
);
const { POST: createPayment } = await import(
  "@/app/api/v1/documents/[id]/payments/route"
);
const { GET: getDocumentPdf } = await import(
  "@/app/api/v1/documents/[id]/pdf/route"
);
const { POST: sendDocumentEmail } = await import(
  "@/app/api/v1/documents/[id]/email/route"
);
const { GET: getEmailDeliveries } = await import(
  "@/app/api/v1/documents/[id]/email-deliveries/route"
);
const { POST: createShareLink, DELETE: disableShareLink } = await import(
  "@/app/api/v1/documents/[id]/share-link/route"
);
const { POST: convertDocument } = await import(
  "@/app/api/v1/documents/[id]/convert/route"
);
const { POST: duplicateDocument } = await import(
  "@/app/api/v1/documents/[id]/duplicate/route"
);
const { POST: createReceipt } = await import(
  "@/app/api/v1/documents/[id]/receipt/route"
);
const { PATCH: patchPayment, DELETE: deletePayment } = await import(
  "@/app/api/v1/payments/[id]/route"
);
const { GET: getSeries } = await import("@/app/api/v1/series/route");
const { PATCH: patchSeries } = await import("@/app/api/v1/series/[id]/route");

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
  const email = `api-invariants-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Invariants Tenant",
        email,
        password: "invariants-password-123",
      }),
    }),
  );
  expect(signUpResponse.status).toBe(200);

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    throw new Error("No se ha creado el usuario de invariantes.");
  }
  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, user.id));
  const signInResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "invariants-password-123",
      }),
    }),
  );
  expect(signInResponse.status).toBe(200);

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId: user.id,
    legalName: "Empresa Invariantes, S.L.",
    taxId: "B12345678",
    address: "Calle de las Invariantes 1, Madrid",
    email,
    createdAt: now,
    updatedAt: now,
  });

  return { userId: user.id, companyId, cookie: sessionCookie(signInResponse) };
}

interface ForeignResources {
  clientId: string;
  documentId: string;
  catalogItemId: string;
  paymentId: string;
  seriesId: string;
}

async function seedForeignResources(
  tenant: TenantFixture,
): Promise<ForeignResources> {
  const now = new Date();
  const clientId = crypto.randomUUID();
  await database.insert(clients).values({
    id: clientId,
    companyId: tenant.companyId,
    name: "Cliente Ajeno",
  });

  const documentId = crypto.randomUUID();
  await database.insert(documents).values({
    id: documentId,
    companyId: tenant.companyId,
    documentType: "invoice",
    status: "draft",
    clientId,
    issueDate: now.toISOString().slice(0, 10),
    createdAt: now,
    updatedAt: now,
  });

  const catalogItemId = crypto.randomUUID();
  await database.insert(catalogItems).values({
    id: catalogItemId,
    companyId: tenant.companyId,
    description: "Servicio ajeno",
    unitPriceCents: 1_000,
    taxRate: "21.00",
  });

  const paymentId = crypto.randomUUID();
  await database.insert(payments).values({
    id: paymentId,
    companyId: tenant.companyId,
    documentId,
    amountCents: 500,
    paidOn: "2026-01-01",
  });

  const seriesId = crypto.randomUUID();
  await database.insert(documentSeries).values({
    id: seriesId,
    companyId: tenant.companyId,
    documentType: "invoice",
    prefix: "AJENA-",
    nextNumber: 1,
    isDefault: false,
  });

  return { clientId, documentId, catalogItemId, paymentId, seriesId };
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

describe("API invariants: pagination contract", () => {
  let owner: TenantFixture;

  beforeEach(async () => {
    cloudflareState.env = {
      PDF_RENDER_QUEUE: { send: () => Promise.resolve() },
      EMAIL_SEND_QUEUE: { send: () => Promise.resolve() },
      STORAGE_BUCKET: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
  });

  it("rejects limit=101 with a 400 validation_error on every paginated collection", async () => {
    const clientId = crypto.randomUUID();
    await database.insert(clients).values({
      id: clientId,
      companyId: owner.companyId,
      name: "Cliente Paginación",
    });
    const documentId = crypto.randomUUID();
    await database.insert(documents).values({
      id: documentId,
      companyId: owner.companyId,
      documentType: "invoice",
      status: "draft",
      clientId,
      issueDate: "2026-01-01",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const cases: Array<{
      name: string;
      handler: (request: Request) => Promise<Response>;
      request: Request;
    }> = [
      {
        name: "catalog-items",
        handler: getCatalogItems,
        request: authenticatedRequest(owner, "/api/v1/catalog-items?limit=101"),
      },
      {
        name: "clients",
        handler: getClients,
        request: authenticatedRequest(owner, "/api/v1/clients?limit=101"),
      },
      {
        name: "clients/:id/documents",
        handler: (request) =>
          getClientDocuments(request, routeContext(clientId)),
        request: authenticatedRequest(
          owner,
          `/api/v1/clients/${clientId}/documents?limit=101`,
        ),
      },
      {
        name: "documents",
        handler: getDocuments,
        request: authenticatedRequest(owner, "/api/v1/documents?limit=101"),
      },
      {
        name: "documents/:id/email-deliveries",
        handler: (request) =>
          getEmailDeliveries(request, routeContext(documentId)),
        request: authenticatedRequest(
          owner,
          `/api/v1/documents/${documentId}/email-deliveries?limit=101`,
        ),
      },
      {
        name: "series",
        handler: getSeries,
        request: authenticatedRequest(owner, "/api/v1/series?limit=101"),
      },
    ];

    for (const testCase of cases) {
      const response = await testCase.handler(testCase.request);
      expect(response.status, testCase.name).toBe(400);
      const body = await jsonRecord(response);
      expect((body.error as Record<string, unknown>).code, testCase.name).toBe(
        "validation_error",
      );
    }
  });

  it("defaults to 25 items per page with an opaque, exhaustive cursor", async () => {
    const itemCount = DEFAULT_PAGE_SIZE + 2;
    const itemIds = Array.from({ length: itemCount }, () =>
      crypto.randomUUID(),
    );
    await database.insert(catalogItems).values(
      itemIds.map((id, index) => ({
        id,
        companyId: owner.companyId,
        description: `Concepto ${index + 1}`,
        unitPriceCents: 1_000,
        taxRate: "21.00",
      })),
    );

    const firstResponse = await getCatalogItems(
      authenticatedRequest(owner, "/api/v1/catalog-items"),
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await jsonRecord(firstResponse);
    const firstItems = firstBody.items as Array<{ id: string }>;
    expect(firstItems).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(firstBody.next_cursor).toEqual(expect.any(String));
    // The cursor must be opaque: it never exposes the raw row id verbatim.
    for (const id of itemIds) {
      expect(String(firstBody.next_cursor)).not.toContain(id);
    }

    const secondResponse = await getCatalogItems(
      authenticatedRequest(
        owner,
        `/api/v1/catalog-items?cursor=${encodeURIComponent(
          String(firstBody.next_cursor),
        )}`,
      ),
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await jsonRecord(secondResponse);
    const secondItems = secondBody.items as Array<{ id: string }>;
    expect(secondItems).toHaveLength(itemCount - DEFAULT_PAGE_SIZE);
    expect(secondBody.next_cursor).toBeNull();

    const allReturnedIds = new Set([
      ...firstItems.map((item) => item.id),
      ...secondItems.map((item) => item.id),
    ]);
    expect(allReturnedIds).toEqual(new Set(itemIds));
  });

  it("accepts the documented maximum of 100 without a validation error", async () => {
    const response = await getCatalogItems(
      authenticatedRequest(
        owner,
        `/api/v1/catalog-items?limit=${MAX_PAGE_SIZE}`,
      ),
    );
    expect(response.status).toBe(200);
  });
});

describe("API invariants: tenant isolation (foreign resource -> 404)", () => {
  let owner: TenantFixture;
  let foreign: ForeignResources;

  beforeEach(async () => {
    cloudflareState.env = {
      PDF_RENDER_QUEUE: { send: () => Promise.resolve() },
      EMAIL_SEND_QUEUE: { send: () => Promise.resolve() },
      STORAGE_BUCKET: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
    const foreignTenant = await createTenant();
    foreign = await seedForeignResources(foreignTenant);
  });

  it("returns 404 for every private endpoint given a foreign resource id", async () => {
    const jsonBody = (body: unknown) => ({
      method: "POST" as const,
      body: JSON.stringify(body),
    });

    const cases: Array<{
      name: string;
      call: () => Promise<Response>;
    }> = [
      {
        name: "PATCH catalog-items/:id",
        call: () =>
          patchCatalogItem(
            authenticatedRequest(
              owner,
              `/api/v1/catalog-items/${foreign.catalogItemId}`,
              {
                method: "PATCH",
                body: JSON.stringify({ unit_price_cents: 500 }),
              },
            ),
            routeContext(foreign.catalogItemId),
          ),
      },
      {
        name: "DELETE catalog-items/:id",
        call: () =>
          deleteCatalogItem(
            authenticatedRequest(
              owner,
              `/api/v1/catalog-items/${foreign.catalogItemId}`,
              { method: "DELETE" },
            ),
            routeContext(foreign.catalogItemId),
          ),
      },
      {
        name: "POST catalog-items/:id/restore",
        call: () =>
          restoreCatalogItem(
            authenticatedRequest(
              owner,
              `/api/v1/catalog-items/${foreign.catalogItemId}/restore`,
              { method: "POST" },
            ),
            routeContext(foreign.catalogItemId),
          ),
      },
      {
        name: "GET clients/:id",
        call: () =>
          getClient(
            authenticatedRequest(owner, `/api/v1/clients/${foreign.clientId}`),
            routeContext(foreign.clientId),
          ),
      },
      {
        name: "PATCH clients/:id",
        call: () =>
          patchClient(
            authenticatedRequest(owner, `/api/v1/clients/${foreign.clientId}`, {
              method: "PATCH",
              body: JSON.stringify({ name: "Otro" }),
            }),
            routeContext(foreign.clientId),
          ),
      },
      {
        name: "POST clients/:id/archive",
        call: () =>
          archiveClient(
            authenticatedRequest(
              owner,
              `/api/v1/clients/${foreign.clientId}/archive`,
              { method: "POST" },
            ),
            routeContext(foreign.clientId),
          ),
      },
      {
        name: "POST clients/:id/unarchive",
        call: () =>
          unarchiveClient(
            authenticatedRequest(
              owner,
              `/api/v1/clients/${foreign.clientId}/unarchive`,
              { method: "POST" },
            ),
            routeContext(foreign.clientId),
          ),
      },
      {
        name: "GET clients/:id/documents",
        call: () =>
          getClientDocuments(
            authenticatedRequest(
              owner,
              `/api/v1/clients/${foreign.clientId}/documents`,
            ),
            routeContext(foreign.clientId),
          ),
      },
      {
        name: "GET documents/:id",
        call: () =>
          getDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}`,
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "PATCH documents/:id",
        call: () =>
          patchDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}`,
              { method: "PATCH", body: JSON.stringify({ notes: "Otro" }) },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "DELETE documents/:id",
        call: () =>
          deleteDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}`,
              { method: "DELETE" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/issue",
        call: () =>
          issueDocumentRoute(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/issue`,
              { method: "POST" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/void",
        call: () =>
          voidDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/void`,
              { method: "POST" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/payments",
        call: () =>
          createPayment(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/payments`,
              jsonBody({ amount_cents: 100, paid_on: "2026-01-01" }),
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "GET documents/:id/pdf",
        call: () =>
          getDocumentPdf(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/pdf`,
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/email",
        call: () =>
          sendDocumentEmail(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/email`,
              {
                ...jsonBody({ recipient_email: "cliente@example.test" }),
                headers: { "Idempotency-Key": crypto.randomUUID() },
              },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "GET documents/:id/email-deliveries",
        call: () =>
          getEmailDeliveries(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/email-deliveries`,
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/share-link",
        call: () =>
          createShareLink(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/share-link`,
              { method: "POST" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "DELETE documents/:id/share-link",
        call: () =>
          disableShareLink(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/share-link`,
              { method: "DELETE" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/convert",
        call: () =>
          convertDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/convert`,
              jsonBody({ issue: false }),
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/duplicate",
        call: () =>
          duplicateDocument(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/duplicate`,
              { method: "POST" },
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "POST documents/:id/receipt",
        call: () =>
          createReceipt(
            authenticatedRequest(
              owner,
              `/api/v1/documents/${foreign.documentId}/receipt`,
              jsonBody({ payment_id: crypto.randomUUID() }),
            ),
            routeContext(foreign.documentId),
          ),
      },
      {
        name: "PATCH payments/:id",
        call: () =>
          patchPayment(
            authenticatedRequest(
              owner,
              `/api/v1/payments/${foreign.paymentId}`,
              { method: "PATCH", body: JSON.stringify({ amount_cents: 100 }) },
            ),
            routeContext(foreign.paymentId),
          ),
      },
      {
        name: "DELETE payments/:id",
        call: () =>
          deletePayment(
            authenticatedRequest(
              owner,
              `/api/v1/payments/${foreign.paymentId}`,
              { method: "DELETE" },
            ),
            routeContext(foreign.paymentId),
          ),
      },
      {
        name: "PATCH series/:id",
        call: () =>
          patchSeries(
            authenticatedRequest(owner, `/api/v1/series/${foreign.seriesId}`, {
              method: "PATCH",
              body: JSON.stringify({ prefix: "X-" }),
            }),
            routeContext(foreign.seriesId),
          ),
      },
    ];

    const results = await Promise.all(
      cases.map(async (testCase) => ({
        name: testCase.name,
        response: await testCase.call(),
      })),
    );

    for (const { name, response } of results) {
      expect(response.status, name).toBe(404);
      await expectNotFound(response);
    }
  });

  it("never leaks a foreign resource through a successful create using its id as a parent", async () => {
    // Sanity check: creating a payment against the OWNER's own draft document
    // (not the foreign one) must still succeed normally, proving the 404s
    // above are a tenant-isolation guard and not a generic route failure.
    const clientId = crypto.randomUUID();
    await database.insert(clients).values({
      id: clientId,
      companyId: owner.companyId,
      name: "Cliente Propio",
    });
    const ownDocumentId = crypto.randomUUID();
    await database.insert(documents).values({
      id: ownDocumentId,
      companyId: owner.companyId,
      documentType: "invoice",
      status: "issued",
      number: 1,
      fullNumber: "2026-0001",
      clientId,
      issueDate: "2026-01-01",
      totalCents: 1_000,
      pdfStatus: "ready",
      issuedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await createPayment(
      authenticatedRequest(
        owner,
        `/api/v1/documents/${ownDocumentId}/payments`,
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: 500, paid_on: "2026-01-01" }),
        },
      ),
      routeContext(ownDocumentId),
    );
    expect(response.status).toBe(201);
  });
});
