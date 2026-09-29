import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clients, companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-payments-contract-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getDashboard } = await import("@/app/api/v1/dashboard/route");
const { GET: getDocuments } = await import("@/app/api/v1/documents/route");
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");
const { POST: createPayment } = await import(
  "@/app/api/v1/documents/[id]/payments/route"
);
const { PATCH: patchPayment, DELETE: deletePayment } = await import(
  "@/app/api/v1/payments/[id]/route"
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
  const email = `payments-contract-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Payments Contract",
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

  return {
    userId: user.id,
    companyId,
    cookie: sessionCookie(signInResponse),
  };
}

async function seedClient(tenant: TenantFixture): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(clients).values({
    id,
    companyId: tenant.companyId,
    name: "Cliente de contrato",
    taxId: "B11223344",
    address: "Avenida del Cliente 2, Valencia",
  });
  return id;
}

async function seedDocument(
  tenant: TenantFixture,
  overrides: {
    clientId: string;
    status?: "draft" | "issued" | "voided";
    documentType?: "invoice" | "proforma";
    totalCents?: number;
    dueDate?: string | null;
    number?: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  const status = overrides.status ?? "issued";
  const documentType = overrides.documentType ?? "invoice";
  const totalCents = overrides.totalCents ?? 10_000;
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType,
    status,
    number: status === "draft" ? undefined : (overrides.number ?? 1),
    fullNumber:
      status === "draft"
        ? undefined
        : `2026-${(overrides.number ?? 1).toString().padStart(4, "0")}`,
    clientId: overrides.clientId,
    issueDate: now.toISOString().slice(0, 10),
    dueDate: overrides.dueDate ?? null,
    totalCents,
    pdfStatus: status === "draft" ? undefined : "pending",
    issuedAt: status === "draft" ? undefined : now,
    issuerSnapshot:
      status === "draft"
        ? undefined
        : { legalName: "Empresa Contrato, S.L.", taxId: "B12345678" },
    clientSnapshot:
      status === "draft" ? undefined : { name: "Cliente de contrato" },
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

describe("payments and dashboard HTTP contract", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
    foreignTenant = await createTenant();
  });

  it("rejects an invalid payment body with actionable field errors", async () => {
    const clientId = await seedClient(owner);
    const documentId = await seedDocument(owner, { clientId });

    const response = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: -100, paid_on: "not-a-date" }),
      }),
      routeContext(documentId),
    );

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);
    expect(body.error).toMatchObject({ code: "validation_error" });
  });

  it("requires explicit confirmation before recording an overpayment", async () => {
    const clientId = await seedClient(owner);
    const documentId = await seedDocument(owner, {
      clientId,
      totalCents: 10_000,
    });

    const overpayAttempt = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount_cents: 10_001,
          paid_on: "2026-09-01",
        }),
      }),
      routeContext(documentId),
    );
    expect(overpayAttempt.status).toBe(409);
    expect((await jsonRecord(overpayAttempt)).error).toMatchObject({
      code: "overpayment_confirmation_required",
    });

    const confirmed = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount_cents: 10_001,
          paid_on: "2026-09-01",
          confirmed_overpayment: true,
        }),
      }),
      routeContext(documentId),
    );
    expect(confirmed.status).toBe(201);
    expect(await jsonRecord(confirmed)).toMatchObject({
      amount_cents: 10_001,
      confirmed_overpayment: true,
    });
  });

  it("rejects payments on a draft document with a conflict", async () => {
    const clientId = await seedClient(owner);
    const documentId = await seedDocument(owner, {
      clientId,
      status: "draft",
    });

    const response = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 100, paid_on: "2026-09-01" }),
      }),
      routeContext(documentId),
    );

    expect(response.status).toBe(409);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "conflict",
    });
  });

  it("returns 404 for a payment on a foreign document, and for foreign payment mutations", async () => {
    const clientId = await seedClient(foreignTenant);
    const foreignDocumentId = await seedDocument(foreignTenant, { clientId });

    const createResponse = await createPayment(
      authenticatedRequest(
        owner,
        `/api/v1/documents/${foreignDocumentId}/payments`,
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: 100, paid_on: "2026-09-01" }),
        },
      ),
      routeContext(foreignDocumentId),
    );
    await expectNotFound(createResponse);

    const ownerClientId = await seedClient(owner);
    const ownerDocumentId = await seedDocument(owner, {
      clientId: ownerClientId,
    });
    const created = await createPayment(
      authenticatedRequest(
        owner,
        `/api/v1/documents/${ownerDocumentId}/payments`,
        {
          method: "POST",
          body: JSON.stringify({ amount_cents: 100, paid_on: "2026-09-01" }),
        },
      ),
      routeContext(ownerDocumentId),
    );
    expect(created.status).toBe(201);
    const paymentId = (await jsonRecord(created)).id as string;

    const patchResponse = await patchPayment(
      authenticatedRequest(foreignTenant, `/api/v1/payments/${paymentId}`, {
        method: "PATCH",
        body: JSON.stringify({ amount_cents: 200 }),
      }),
      routeContext(paymentId),
    );
    await expectNotFound(patchResponse);

    const deleteResponse = await deletePayment(
      authenticatedRequest(foreignTenant, `/api/v1/payments/${paymentId}`, {
        method: "DELETE",
      }),
      routeContext(paymentId),
    );
    await expectNotFound(deleteResponse);

    const missingId = crypto.randomUUID();
    const missingPatch = await patchPayment(
      authenticatedRequest(owner, `/api/v1/payments/${missingId}`, {
        method: "PATCH",
        body: JSON.stringify({ amount_cents: 200 }),
      }),
      routeContext(missingId),
    );
    await expectNotFound(missingPatch);
  });

  it("requires at least one field and rejects an empty PATCH body", async () => {
    const clientId = await seedClient(owner);
    const documentId = await seedDocument(owner, { clientId });
    const created = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 100, paid_on: "2026-09-01" }),
      }),
      routeContext(documentId),
    );
    const paymentId = (await jsonRecord(created)).id as string;

    const response = await patchPayment(
      authenticatedRequest(owner, `/api/v1/payments/${paymentId}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      routeContext(paymentId),
    );

    expect(response.status).toBe(400);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "validation_error",
    });
  });

  it("exposes the derived payment_status on the paginated document collection", async () => {
    const clientId = await seedClient(owner);
    const paidId = await seedDocument(owner, {
      clientId,
      totalCents: 5_000,
      number: 1,
    });
    await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${paidId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 5_000, paid_on: "2026-09-01" }),
      }),
      routeContext(paidId),
    );
    await seedDocument(owner, {
      clientId,
      totalCents: 5_000,
      number: 2,
      dueDate: "2020-01-01",
    });

    const paidResponse = await getDocuments(
      authenticatedRequest(owner, "/api/v1/documents?payment_status=paid"),
    );
    expect(paidResponse.status).toBe(200);
    const paidBody = await jsonRecord(paidResponse);
    const paidItems = paidBody.items as Array<Record<string, unknown>>;
    expect(paidItems).toHaveLength(1);
    expect(paidItems[0]).toMatchObject({ id: paidId, payment_status: "paid" });

    const overdueResponse = await getDocuments(
      authenticatedRequest(owner, "/api/v1/documents?payment_status=overdue"),
    );
    const overdueBody = await jsonRecord(overdueResponse);
    expect(
      (overdueBody.items as Array<Record<string, unknown>>).map(
        (item) => item.payment_status,
      ),
    ).toEqual(["overdue"]);
  });

  it("returns the dashboard aggregate shape for the requested period", async () => {
    const clientId = await seedClient(owner);
    await seedDocument(owner, { clientId, totalCents: 5_000, number: 1 });
    const overdueId = await seedDocument(owner, {
      clientId,
      totalCents: 3_000,
      number: 2,
      dueDate: "2020-01-01",
    });
    await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${overdueId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 1_000, paid_on: "2026-01-01" }),
      }),
      routeContext(overdueId),
    );

    const response = await getDashboard(
      authenticatedRequest(owner, "/api/v1/dashboard"),
    );
    expect(response.status).toBe(200);
    expect(await jsonRecord(response)).toEqual({
      paid_cents: 1_000,
      pending_cents: 5_000,
      overdue_cents: 2_000,
      counts_by_status: { pending: 1, partial: 0, paid: 0, overdue: 1 },
    });
  });

  it("rejects an inverted dashboard date range", async () => {
    const response = await getDashboard(
      authenticatedRequest(
        owner,
        "/api/v1/dashboard?from=2026-09-30&to=2026-09-01",
      ),
    );

    expect(response.status).toBe(400);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "validation_error",
    });
  });

  it("keeps every document detail's derived payment fields consistent with the collection", async () => {
    const clientId = await seedClient(owner);
    const documentId = await seedDocument(owner, {
      clientId,
      totalCents: 5_000,
    });
    await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 2_000, paid_on: "2026-09-01" }),
      }),
      routeContext(documentId),
    );

    const detail = await getDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}`),
      routeContext(documentId),
    );
    expect(await jsonRecord(detail)).toMatchObject({
      paid_cents: 2_000,
      outstanding_cents: 3_000,
      payment_status: "partial",
    });
  });
});
