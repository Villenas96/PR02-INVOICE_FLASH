import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clients, companies, documents, payments, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-document-variants-secret-at-least-32-chars";
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
const { GET: getSeries } = await import("@/app/api/v1/series/route");
const { POST: createDocument } = await import("@/app/api/v1/documents/route");
const { POST: issueDocumentRoute } = await import(
  "@/app/api/v1/documents/[id]/issue/route"
);
const { POST: convertDocument } = await import(
  "@/app/api/v1/documents/[id]/convert/route"
);
const { POST: createReceipt } = await import(
  "@/app/api/v1/documents/[id]/receipt/route"
);
const { POST: duplicateDocument } = await import(
  "@/app/api/v1/documents/[id]/duplicate/route"
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
  const email = `document-variants-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Document Variants",
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
    legalName: "Empresa Variantes, S.L.",
    taxId: "B12345678",
    address: "Calle de las Variantes 1, Madrid",
    email,
    createdAt: now,
    updatedAt: now,
  });

  const tenant: TenantFixture = {
    userId: user.id,
    companyId,
    cookie: sessionCookie(signInResponse),
  };
  // Default series are only bootstrapped lazily (normally by the /documents/new
  // page load); an API-only flow must trigger it explicitly before issuing.
  for (const docType of ["invoice", "proforma"] as const) {
    const seriesResponse = await getSeries(
      authenticatedRequest(tenant, `/api/v1/series?doc_type=${docType}`),
    );
    expect(seriesResponse.status).toBe(200);
  }

  return tenant;
}

async function seedClient(tenant: TenantFixture): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(clients).values({
    id,
    companyId: tenant.companyId,
    name: "Cliente Variantes",
    // Converting to an invoice requires the client's tax id and address.
    taxId: "A87654321",
    address: "Calle del Cliente 2, Madrid",
  });
  return id;
}

async function createIssuedProforma(
  tenant: TenantFixture,
  clientId: string,
): Promise<string> {
  const createResponse = await createDocument(
    authenticatedRequest(tenant, "/api/v1/documents", {
      method: "POST",
      body: JSON.stringify({
        doc_type: "proforma",
        client_id: clientId,
        lines: [
          {
            description: "Servicio",
            quantity: "1",
            unit_price_cents: 10_000,
            tax_rate: "21.00",
          },
        ],
      }),
    }),
  );
  expect(createResponse.status).toBe(201);
  const created = await jsonRecord(createResponse);
  const issueResponse = await issueDocumentRoute(
    authenticatedRequest(tenant, `/api/v1/documents/${created.id}/issue`, {
      method: "POST",
    }),
    routeContext(created.id as string),
  );
  expect(issueResponse.status).toBe(200);
  return created.id as string;
}

async function createIssuedInvoice(
  tenant: TenantFixture,
  clientId: string,
  number: number,
): Promise<string> {
  const now = new Date();
  const id = crypto.randomUUID();
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    status: "issued",
    number,
    fullNumber: `2026-${number.toString().padStart(4, "0")}`,
    clientId,
    issueDate: now.toISOString().slice(0, 10),
    totalCents: 5_000,
    pdfStatus: "ready",
    issuedAt: now,
    issuerSnapshot: { legalName: "Empresa Variantes, S.L." },
    clientSnapshot: { name: "Cliente Variantes" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedPayment(
  tenant: TenantFixture,
  invoiceId: string,
  amountCents: number,
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(payments).values({
    id,
    companyId: tenant.companyId,
    documentId: invoiceId,
    amountCents,
    paidOn: new Date().toISOString().slice(0, 10),
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

describe("document variants (convert/receipt/duplicate) HTTP contract", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    cloudflareState.env = {
      PDF_RENDER_QUEUE: { send: () => Promise.resolve() },
    };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
    foreignTenant = await createTenant();
  });

  it("rejects a manual receipt creation through the generic draft endpoint", async () => {
    const clientId = await seedClient(owner);
    const response = await createDocument(
      authenticatedRequest(owner, "/api/v1/documents", {
        method: "POST",
        body: JSON.stringify({
          doc_type: "receipt",
          client_id: clientId,
          lines: [],
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("converts a proforma to a draft invoice, then to the same draft again idempotently", async () => {
    const clientId = await seedClient(owner);
    const proformaId = await createIssuedProforma(owner, clientId);

    const first = await convertDocument(
      authenticatedRequest(owner, `/api/v1/documents/${proformaId}/convert`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeContext(proformaId),
    );
    expect(first.status).toBe(200);
    const firstBody = await jsonRecord(first);
    expect(firstBody.doc_type).toBe("invoice");
    expect(firstBody.status).toBe("draft");

    const second = await convertDocument(
      authenticatedRequest(owner, `/api/v1/documents/${proformaId}/convert`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      routeContext(proformaId),
    );
    expect((await jsonRecord(second)).id).toBe(firstBody.id);
  });

  it("issues the converted invoice directly and resolves the same one afterwards", async () => {
    const clientId = await seedClient(owner);
    const proformaId = await createIssuedProforma(owner, clientId);

    const first = await convertDocument(
      authenticatedRequest(owner, `/api/v1/documents/${proformaId}/convert`, {
        method: "POST",
        body: JSON.stringify({ issue: true }),
      }),
      routeContext(proformaId),
    );
    expect(first.status).toBe(200);
    const firstBody = await jsonRecord(first);
    expect(firstBody.status).toBe("issued");
    expect(firstBody.full_number).toBeTruthy();

    const second = await convertDocument(
      authenticatedRequest(owner, `/api/v1/documents/${proformaId}/convert`, {
        method: "POST",
        body: JSON.stringify({ issue: true }),
      }),
      routeContext(proformaId),
    );
    expect((await jsonRecord(second)).id).toBe(firstBody.id);
  });

  it("generates a receipt for a payment and resolves the same receipt on replay, even after quota exhaustion", async () => {
    const clientId = await seedClient(owner);
    const invoiceId = await createIssuedInvoice(owner, clientId, 1);
    const paymentId = await seedPayment(owner, invoiceId, 5_000);

    const first = await createReceipt(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/receipt`, {
        method: "POST",
        body: JSON.stringify({ payment_id: paymentId }),
      }),
      routeContext(invoiceId),
    );
    expect(first.status).toBe(201);
    const firstBody = await jsonRecord(first);
    expect(firstBody.doc_type).toBe("receipt");
    expect(firstBody.total_cents).toBe(5_000);

    // Exhaust the free plan's monthly quota (5 issued documents) with other
    // invoices — the existing receipt must still resolve without a 402.
    for (let number = 2; number <= 5; number += 1) {
      await createIssuedInvoice(owner, clientId, number);
    }

    const second = await createReceipt(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/receipt`, {
        method: "POST",
        body: JSON.stringify({ payment_id: paymentId }),
      }),
      routeContext(invoiceId),
    );
    expect(second.status).toBe(200);
    expect((await jsonRecord(second)).id).toBe(firstBody.id);
  });

  it("rejects a new direct emission at quota with 402 and no side effects", async () => {
    const clientId = await seedClient(owner);
    // The free plan's monthly quota is shared across every document type, so
    // issuing this proforma itself consumes the final (fifth) slot.
    for (let number = 1; number <= 4; number += 1) {
      await createIssuedInvoice(owner, clientId, number);
    }
    const proformaId = await createIssuedProforma(owner, clientId);

    const response = await convertDocument(
      authenticatedRequest(owner, `/api/v1/documents/${proformaId}/convert`, {
        method: "POST",
        body: JSON.stringify({ issue: true }),
      }),
      routeContext(proformaId),
    );
    expect(response.status).toBe(402);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "plan_limit_reached",
    });

    // Draft-mode conversion is free of charge (no plan quota); the linked
    // invoice draft is created, but it must stay unissued and numberless.
    const [proforma] = await database
      .select({ convertedToId: documents.convertedToId })
      .from(documents)
      .where(eq(documents.id, proformaId));
    expect(proforma?.convertedToId).toBeTruthy();

    const [linkedDraft] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, proforma?.convertedToId as string));
    expect(linkedDraft).toMatchObject({ status: "draft", number: null });
  });

  it("duplicates an invoice or proforma to a numberless draft, but rejects receipts", async () => {
    const clientId = await seedClient(owner);
    const invoiceId = await createIssuedInvoice(owner, clientId, 1);

    const duplicateResponse = await duplicateDocument(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/duplicate`, {
        method: "POST",
      }),
      routeContext(invoiceId),
    );
    expect(duplicateResponse.status).toBe(201);
    expect(await jsonRecord(duplicateResponse)).toMatchObject({
      doc_type: "invoice",
      status: "draft",
    });

    const paymentId = await seedPayment(owner, invoiceId, 5_000);
    const receiptResponse = await createReceipt(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/receipt`, {
        method: "POST",
        body: JSON.stringify({ payment_id: paymentId }),
      }),
      routeContext(invoiceId),
    );
    const receiptId = (await jsonRecord(receiptResponse)).id as string;

    const rejectedDuplicate = await duplicateDocument(
      authenticatedRequest(owner, `/api/v1/documents/${receiptId}/duplicate`, {
        method: "POST",
      }),
      routeContext(receiptId),
    );
    expect(rejectedDuplicate.status).toBe(409);
  });

  it("returns 404 for every foreign-document conversion, receipt and duplication attempt", async () => {
    const foreignClientId = await seedClient(foreignTenant);
    const foreignProformaId = await createIssuedProforma(
      foreignTenant,
      foreignClientId,
    );
    const foreignInvoiceId = await createIssuedInvoice(
      foreignTenant,
      foreignClientId,
      1,
    );
    const foreignPaymentId = await seedPayment(
      foreignTenant,
      foreignInvoiceId,
      1_000,
    );

    const responses = await Promise.all([
      convertDocument(
        authenticatedRequest(
          owner,
          `/api/v1/documents/${foreignProformaId}/convert`,
          { method: "POST", body: JSON.stringify({}) },
        ),
        routeContext(foreignProformaId),
      ),
      createReceipt(
        authenticatedRequest(
          owner,
          `/api/v1/documents/${foreignInvoiceId}/receipt`,
          {
            method: "POST",
            body: JSON.stringify({ payment_id: foreignPaymentId }),
          },
        ),
        routeContext(foreignInvoiceId),
      ),
      duplicateDocument(
        authenticatedRequest(
          owner,
          `/api/v1/documents/${foreignInvoiceId}/duplicate`,
          { method: "POST" },
        ),
        routeContext(foreignInvoiceId),
      ),
    ]);

    for (const response of responses) {
      await expectNotFound(response);
    }
  });
});
