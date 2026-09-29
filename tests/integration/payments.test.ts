import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clients, companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-payments-lifecycle-secret-at-least-32-chars";
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
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");
const { POST: voidDocument } = await import(
  "@/app/api/v1/documents/[id]/void/route"
);
const { POST: createPayment } = await import(
  "@/app/api/v1/documents/[id]/payments/route"
);
const { DELETE: deletePayment } = await import(
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
  const email = `payments-lifecycle-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Payments Lifecycle",
        email,
        password: "lifecycle-password-123",
      }),
    }),
  );
  expect(signUpResponse.status).toBe(200);

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    throw new Error("No se ha creado el usuario de ciclo de vida.");
  }

  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, user.id));
  const signInResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "lifecycle-password-123" }),
    }),
  );
  expect(signInResponse.status).toBe(200);

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId: user.id,
    legalName: "Empresa Ciclo, S.L.",
    taxId: "B12345678",
    address: "Calle del Ciclo 1, Madrid",
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
    name: "Cliente de ciclo de vida",
  });
  return id;
}

async function seedIssuedInvoice(
  tenant: TenantFixture,
  overrides: {
    clientId: string;
    number: number;
    totalCents: number;
    dueDate?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    status: "issued",
    number: overrides.number,
    fullNumber: `2026-${overrides.number.toString().padStart(4, "0")}`,
    clientId: overrides.clientId,
    issueDate: now.toISOString().slice(0, 10),
    dueDate: overrides.dueDate ?? null,
    totalCents: overrides.totalCents,
    pdfStatus: "pending",
    issuedAt: now,
    issuerSnapshot: { legalName: "Empresa Ciclo, S.L.", taxId: "B12345678" },
    clientSnapshot: { name: "Cliente de ciclo de vida" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function detailOf(
  tenant: TenantFixture,
  documentId: string,
): Promise<Record<string, unknown>> {
  const response = await getDocument(
    authenticatedRequest(tenant, `/api/v1/documents/${documentId}`),
    routeContext(documentId),
  );
  expect(response.status).toBe(200);
  return jsonRecord(response);
}

describe("payment lifecycle (real Postgres)", () => {
  let owner: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
  });

  it("moves an invoice from pending through partial to paid as payments accrue", async () => {
    const clientId = await seedClient(owner);
    const invoiceId = await seedIssuedInvoice(owner, {
      clientId,
      number: 1,
      totalCents: 10_000,
    });

    expect(await detailOf(owner, invoiceId)).toMatchObject({
      payment_status: "pending",
      paid_cents: 0,
      outstanding_cents: 10_000,
    });

    const firstPayment = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 4_000, paid_on: "2026-09-01" }),
      }),
      routeContext(invoiceId),
    );
    expect(firstPayment.status).toBe(201);
    expect(await detailOf(owner, invoiceId)).toMatchObject({
      payment_status: "partial",
      paid_cents: 4_000,
      outstanding_cents: 6_000,
    });

    const secondPayment = await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 6_000, paid_on: "2026-09-15" }),
      }),
      routeContext(invoiceId),
    );
    expect(secondPayment.status).toBe(201);
    const secondPaymentId = (await jsonRecord(secondPayment)).id as string;
    expect(await detailOf(owner, invoiceId)).toMatchObject({
      payment_status: "paid",
      paid_cents: 10_000,
      outstanding_cents: 0,
    });

    const deleteResponse = await deletePayment(
      authenticatedRequest(owner, `/api/v1/payments/${secondPaymentId}`, {
        method: "DELETE",
      }),
      routeContext(secondPaymentId),
    );
    expect(deleteResponse.status).toBe(204);
    expect(await detailOf(owner, invoiceId)).toMatchObject({
      payment_status: "partial",
      paid_cents: 4_000,
      outstanding_cents: 6_000,
    });
  });

  it("classifies an unpaid invoice past its due date as overdue", async () => {
    const clientId = await seedClient(owner);
    const overdueId = await seedIssuedInvoice(owner, {
      clientId,
      number: 1,
      totalCents: 5_000,
      dueDate: "2020-01-01",
    });

    expect(await detailOf(owner, overdueId)).toMatchObject({
      payment_status: "overdue",
      paid_cents: 0,
      outstanding_cents: 5_000,
    });
  });

  it("excludes a voided invoice from its own derived status and from dashboard aggregates", async () => {
    const clientId = await seedClient(owner);
    await seedIssuedInvoice(owner, {
      clientId,
      number: 1,
      totalCents: 5_000,
    });
    const toVoidId = await seedIssuedInvoice(owner, {
      clientId,
      number: 2,
      totalCents: 7_000,
    });
    await createPayment(
      authenticatedRequest(owner, `/api/v1/documents/${toVoidId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: 3_000, paid_on: "2026-09-01" }),
      }),
      routeContext(toVoidId),
    );

    const beforeVoid = await getDashboard(
      authenticatedRequest(owner, "/api/v1/dashboard"),
    );
    expect(await jsonRecord(beforeVoid)).toEqual({
      paid_cents: 3_000,
      pending_cents: 5_000 + 4_000,
      overdue_cents: 0,
      counts_by_status: { pending: 1, partial: 1, paid: 0, overdue: 0 },
    });

    const voidResponse = await voidDocument(
      authenticatedRequest(owner, `/api/v1/documents/${toVoidId}/void`, {
        method: "POST",
      }),
      routeContext(toVoidId),
    );
    expect(voidResponse.status).toBe(200);

    expect(await detailOf(owner, toVoidId)).toMatchObject({
      status: "voided",
      payment_status: null,
    });

    const afterVoid = await getDashboard(
      authenticatedRequest(owner, "/api/v1/dashboard"),
    );
    expect(await jsonRecord(afterVoid)).toEqual({
      paid_cents: 0,
      pending_cents: 5_000,
      overdue_cents: 0,
      counts_by_status: { pending: 1, partial: 0, paid: 0, overdue: 0 },
    });
  });
});
