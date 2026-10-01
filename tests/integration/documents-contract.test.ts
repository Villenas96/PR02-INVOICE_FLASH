import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documentLines,
  documentSeries,
  documents,
  users,
} from "@/db/schema";
import {
  type PrivateBucket,
  pdfObjectKey,
  type R2ObjectBody,
} from "@/services/storage";

import { createIntegrationDatabase } from "./database";

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getCompany } = await import("@/app/api/v1/company/route");
const { GET: getSeries } = await import("@/app/api/v1/series/route");
const { PATCH: patchSeries } = await import("@/app/api/v1/series/[id]/route");
const { GET: getClients } = await import("@/app/api/v1/clients/route");
const { GET: getDocuments } = await import("@/app/api/v1/documents/route");
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");
const { POST: issueDocument } = await import(
  "@/app/api/v1/documents/[id]/issue/route"
);
const { POST: voidDocument } = await import(
  "@/app/api/v1/documents/[id]/void/route"
);
const { GET: getDocumentPdf } = await import(
  "@/app/api/v1/documents/[id]/pdf/route"
);

type Plan = "free" | "pro";
type PdfStatus = "failed" | "pending" | "ready";

interface TenantFixture {
  userId: string;
  companyId: string;
  cookie: string;
  plan: Plan;
}

interface CollectionPage {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
}

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

class InMemoryPrivateBucket implements PrivateBucket {
  readonly objects = new Map<string, StoredObject>();

  get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) {
      return Promise.resolve(null);
    }

    const bytes = object.bytes.slice();
    return Promise.resolve({
      body: new Blob([bytes.buffer]).stream(),
      httpMetadata: { contentType: object.contentType },
    });
  }

  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    this.objects.set(key, {
      bytes: value.slice(),
      contentType: options?.httpMetadata?.contentType ?? "application/pdf",
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

let bucket = new InMemoryPrivateBucket();
const queuedMessages: unknown[] = [];

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

async function collectionPage(response: Response): Promise<CollectionPage> {
  expect(response.status).toBe(200);
  const body = await jsonRecord(response);
  if (!Array.isArray(body.items) || !body.items.every(isRecord)) {
    throw new Error("La colección debe devolver items como objetos.");
  }
  if (body.next_cursor !== null && typeof body.next_cursor !== "string") {
    throw new Error("next_cursor debe ser opaco o null.");
  }
  return {
    items: body.items,
    nextCursor: body.next_cursor,
  };
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

async function createTenant(plan: Plan): Promise<TenantFixture> {
  const suffix = crypto.randomUUID();
  const email = `contract-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Contract ${plan}`,
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
      body: JSON.stringify({
        email,
        password: "contract-password-123",
      }),
    }),
  );
  expect(signInResponse.status).toBe(200);

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId: user.id,
    legalName: `Empresa ${plan}, S.L.`,
    taxId: plan === "free" ? "B12345678" : "A87654321",
    address: "Calle del Contrato 1, Madrid",
    email,
    plan,
    createdAt: now,
    updatedAt: now,
  });

  return {
    userId: user.id,
    companyId,
    cookie: sessionCookie(signInResponse),
    plan,
  };
}

async function seedClient(
  tenant: TenantFixture,
  name: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(clients).values({
    id,
    companyId: tenant.companyId,
    name,
    taxId: "B11223344",
    address: "Avenida del Cliente 2, Valencia",
    email: `${id}@example.test`,
  });
  return id;
}

async function seedSeries(
  tenant: TenantFixture,
  prefix: string,
  nextNumber = 1,
  isDefault = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(documentSeries).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    prefix,
    nextNumber,
    isDefault,
  });
  return id;
}

async function seedDocument({
  clientId,
  number,
  pdfStatus,
  seriesId,
  status,
  tenant,
}: {
  clientId: string;
  number?: number;
  pdfStatus?: PdfStatus;
  seriesId?: string;
  status: "draft" | "issued" | "voided";
  tenant: TenantFixture;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    status,
    seriesId,
    number,
    fullNumber:
      number === undefined
        ? undefined
        : `2026-${number.toString().padStart(4, "0")}`,
    clientId,
    issueDate: now.toISOString().slice(0, 10),
    pdfStatus,
    pdfReadyAt: pdfStatus === "ready" ? now : undefined,
    issuedAt: status === "draft" ? undefined : now,
    issuerSnapshot:
      status === "draft"
        ? undefined
        : {
            legalName: `Empresa ${tenant.plan}, S.L.`,
            taxId: tenant.plan === "free" ? "B12345678" : "A87654321",
            address: "Calle del Contrato 1, Madrid",
          },
    clientSnapshot:
      status === "draft"
        ? undefined
        : {
            name: "Cliente Contrato",
            taxId: "B11223344",
            address: "Avenida del Cliente 2, Valencia",
          },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedLine(documentId: string): Promise<void> {
  await database.insert(documentLines).values({
    id: crypto.randomUUID(),
    documentId,
    position: 1,
    description: "Servicio de contrato",
    quantity: "1.000",
    unitPriceCents: 10_000,
    taxRate: "21.00",
    discountPercentage: "0.00",
  });
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

describe("documents HTTP contract", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    queuedMessages.length = 0;
    bucket = new InMemoryPrivateBucket();
    cloudflareState.env = {
      PDF_RENDER_QUEUE: {
        send(message: unknown) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
      },
      STORAGE_BUCKET: bucket,
    };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant("free");
    foreignTenant = await createTenant("pro");
  });

  it("returns company readiness and plan capabilities with Madrid-month usage", async () => {
    const clientId = await seedClient(owner, "Cliente de capacidades");
    const seriesId = await seedSeries(owner, "CAP-", 5, true);
    for (let number = 1; number <= 4; number += 1) {
      await seedDocument({
        tenant: owner,
        clientId,
        seriesId,
        number,
        status: number === 4 ? "voided" : "issued",
        pdfStatus: "ready",
      });
    }

    const freeResponse = await getCompany(
      authenticatedRequest(owner, "/api/v1/company"),
    );
    expect(freeResponse.status).toBe(200);
    expect(await jsonRecord(freeResponse)).toMatchObject({
      is_ready_to_issue: true,
      plan: "free",
      docs_issued_this_month: 4,
      doc_limit: 5,
      can_send_email: false,
      usage_warning: true,
    });

    await database
      .update(companies)
      .set({ plan: "pro" })
      .where(eq(companies.id, owner.companyId));
    const proResponse = await getCompany(
      authenticatedRequest(owner, "/api/v1/company"),
    );
    expect(proResponse.status).toBe(200);
    expect(await jsonRecord(proResponse)).toMatchObject({
      plan: "pro",
      docs_issued_this_month: 4,
      doc_limit: 100,
      can_send_email: true,
      usage_warning: false,
    });
  });

  it("paginates series, clients and documents with opaque cursors", async () => {
    const clientIds = await Promise.all(
      ["Cliente A", "Cliente B", "Cliente C"].map((name) =>
        seedClient(owner, name),
      ),
    );
    const seriesIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      seriesIds.push(
        await seedSeries(owner, `PAGE-${index + 1}-`, 1, index === 0),
      );
    }
    const documentIds = await Promise.all(
      clientIds.map((clientId) =>
        seedDocument({ tenant: owner, clientId, status: "draft" }),
      ),
    );

    const collections: Array<{
      path: string;
      expectedIds: string[];
      handler: (request: Request) => Promise<Response>;
    }> = [
      {
        path: "/api/v1/series?doc_type=invoice",
        expectedIds: seriesIds,
        handler: getSeries,
      },
      {
        path: "/api/v1/clients",
        expectedIds: clientIds,
        handler: getClients,
      },
      {
        path: "/api/v1/documents?type=invoice&status=draft",
        expectedIds: documentIds,
        handler: getDocuments,
      },
    ];

    for (const collection of collections) {
      const separator = collection.path.includes("?") ? "&" : "?";
      const firstPage = await collectionPage(
        await collection.handler(
          authenticatedRequest(owner, `${collection.path}${separator}limit=2`),
        ),
      );
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      for (const rawId of collection.expectedIds) {
        expect(firstPage.nextCursor).not.toContain(rawId);
      }

      const secondPage = await collectionPage(
        await collection.handler(
          authenticatedRequest(
            owner,
            `${collection.path}${separator}limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          ),
        ),
      );
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();

      const returnedIds = [...firstPage.items, ...secondPage.items].map(
        (item) => item.id,
      );
      expect(new Set(returnedIds)).toEqual(new Set(collection.expectedIds));
    }

    const invalidLimit = await getDocuments(
      authenticatedRequest(owner, "/api/v1/documents?limit=101"),
    );
    expect(invalidLimit.status).toBe(400);
    const invalidBody = await jsonRecord(invalidLimit);
    expect(invalidBody).toMatchObject({
      error: {
        code: "validation_error",
      },
    });
    expect(
      String((invalidBody.error as Record<string, unknown>).message),
    ).toMatch(/entre|máximo|100/i);
  });

  it("rejects issuing an invoice whose client lacks tax id or address, without side effects", async () => {
    const clientId = await seedClient(owner, "Cliente sin dirección");
    await database
      .update(clients)
      .set({ address: null })
      .where(eq(clients.id, clientId));
    const seriesId = await seedSeries(owner, "2026-", 1, true);
    const documentId = await seedDocument({
      tenant: owner,
      clientId,
      status: "draft",
    });
    await seedLine(documentId);

    const response = await issueDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/issue`, {
        method: "POST",
      }),
      routeContext(documentId),
    );

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("validation_error");
    expect(JSON.stringify(error)).toContain("client.address");
    expect(JSON.stringify(error)).not.toContain("client.taxId");

    const [document] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document).toEqual({ status: "draft", number: null });
    const [series] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, seriesId));
    expect(series?.nextNumber).toBe(1);
  });

  it("issues a draft and then voids the immutable issued document", async () => {
    const clientId = await seedClient(owner, "Cliente emisión");
    await seedSeries(owner, "2026-", 1, true);
    const documentId = await seedDocument({
      tenant: owner,
      clientId,
      status: "draft",
    });
    await seedLine(documentId);

    const issueResponse = await issueDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/issue`, {
        method: "POST",
      }),
      routeContext(documentId),
    );
    expect(issueResponse.status).toBe(200);
    expect(await jsonRecord(issueResponse)).toMatchObject({
      id: documentId,
      status: "issued",
      number: 1,
      full_number: "2026-0001",
      pdf_status: "pending",
    });

    const voidResponse = await voidDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/void`, {
        method: "POST",
      }),
      routeContext(documentId),
    );
    expect(voidResponse.status).toBe(200);
    expect(await jsonRecord(voidResponse)).toMatchObject({
      id: documentId,
      status: "voided",
      number: 1,
      full_number: "2026-0001",
    });

    const reissueResponse = await issueDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}/issue`, {
        method: "POST",
      }),
      routeContext(documentId),
    );
    expect(reissueResponse.status).toBe(409);
    const reissueBody = await jsonRecord(reissueResponse);
    expect(reissueBody).toMatchObject({
      error: { code: "conflict" },
    });
    expect(
      String((reissueBody.error as Record<string, unknown>).message),
    ).toMatch(/anulado|emitido|borrador/i);
  });

  it("serves ready PDFs and reports pending or failed states without rendering", async () => {
    const clientId = await seedClient(owner, "Cliente PDF");
    const seriesId = await seedSeries(owner, "PDF-", 4, true);
    const readyId = await seedDocument({
      tenant: owner,
      clientId,
      seriesId,
      number: 1,
      status: "issued",
      pdfStatus: "ready",
    });
    const pendingId = await seedDocument({
      tenant: owner,
      clientId,
      seriesId,
      number: 2,
      status: "issued",
      pdfStatus: "pending",
    });
    const failedId = await seedDocument({
      tenant: owner,
      clientId,
      seriesId,
      number: 3,
      status: "issued",
      pdfStatus: "failed",
    });
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\ncontract\n%%EOF");
    await bucket.put(pdfObjectKey(readyId), pdfBytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const readyResponse = await getDocumentPdf(
      authenticatedRequest(owner, `/api/v1/documents/${readyId}/pdf`),
      routeContext(readyId),
    );
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.headers.get("content-type")).toContain(
      "application/pdf",
    );
    expect(readyResponse.headers.get("content-disposition")).toMatch(
      /attachment/i,
    );
    expect(new Uint8Array(await readyResponse.arrayBuffer())).toEqual(pdfBytes);

    const pendingResponse = await getDocumentPdf(
      authenticatedRequest(owner, `/api/v1/documents/${pendingId}/pdf`),
      routeContext(pendingId),
    );
    expect(pendingResponse.status).toBe(202);
    expect(pendingResponse.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await jsonRecord(pendingResponse)).toEqual({
      status: "processing",
      code: "pdf_processing",
    });

    const failedResponse = await getDocumentPdf(
      authenticatedRequest(owner, `/api/v1/documents/${failedId}/pdf`),
      routeContext(failedId),
    );
    expect(failedResponse.status).toBe(409);
    const failedBody = await jsonRecord(failedResponse);
    expect(failedBody).toMatchObject({
      error: { code: "pdf_generation_failed" },
    });
    expect(
      String((failedBody.error as Record<string, unknown>).message),
    ).toMatch(/PDF|generar|reintentar/i);
  });

  it.each([
    { plan: "free" as const, limit: 5 },
    { plan: "pro" as const, limit: 100 },
  ])(
    "enforces the exact $plan=$limit limit with a side-effect-free 402",
    async ({ plan, limit }) => {
      const tenant = plan === "free" ? owner : foreignTenant;
      const clientId = await seedClient(tenant, `Cliente límite ${plan}`);
      const seriesId = await seedSeries(
        tenant,
        `${plan.toUpperCase()}-`,
        limit,
        true,
      );
      const now = new Date();
      const existingValues = Array.from({ length: limit - 1 }, (_, index) => {
        const number = index + 1;
        return {
          id: crypto.randomUUID(),
          companyId: tenant.companyId,
          documentType: "invoice" as const,
          status: "issued" as const,
          seriesId,
          number,
          fullNumber: `${plan.toUpperCase()}-${number.toString().padStart(4, "0")}`,
          clientId,
          issueDate: now.toISOString().slice(0, 10),
          pdfStatus: "ready" as const,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        };
      });
      if (existingValues.length > 0) {
        await database.insert(documents).values(existingValues);
      }
      const allowedDraftId = await seedDocument({
        tenant,
        clientId,
        status: "draft",
      });
      const rejectedDraftId = await seedDocument({
        tenant,
        clientId,
        status: "draft",
      });
      await seedLine(allowedDraftId);
      await seedLine(rejectedDraftId);
      queuedMessages.length = 0;

      const allowedResponse = await issueDocument(
        authenticatedRequest(
          tenant,
          `/api/v1/documents/${allowedDraftId}/issue`,
          { method: "POST" },
        ),
        routeContext(allowedDraftId),
      );
      expect(allowedResponse.status).toBe(200);

      const rejectedResponse = await issueDocument(
        authenticatedRequest(
          tenant,
          `/api/v1/documents/${rejectedDraftId}/issue`,
          { method: "POST" },
        ),
        routeContext(rejectedDraftId),
      );
      expect(rejectedResponse.status).toBe(402);
      const rejectedBody = await jsonRecord(rejectedResponse);
      expect(rejectedBody).toMatchObject({
        error: { code: "plan_limit_reached" },
      });
      expect(
        String((rejectedBody.error as Record<string, unknown>).message),
      ).toMatch(/límite|plan/i);

      const [rejectedRow] = await database
        .select({
          status: documents.status,
          seriesId: documents.seriesId,
          number: documents.number,
          fullNumber: documents.fullNumber,
          pdfStatus: documents.pdfStatus,
          issuedAt: documents.issuedAt,
        })
        .from(documents)
        .where(eq(documents.id, rejectedDraftId));
      expect(rejectedRow).toEqual({
        status: "draft",
        seriesId: null,
        number: null,
        fullNumber: null,
        pdfStatus: null,
        issuedAt: null,
      });

      const [series] = await database
        .select({ nextNumber: documentSeries.nextNumber })
        .from(documentSeries)
        .where(eq(documentSeries.id, seriesId));
      expect(series?.nextNumber).toBe(limit + 1);

      const events = await database
        .select({ documentId: documentEvents.documentId })
        .from(documentEvents)
        .where(
          inArray(documentEvents.documentId, [allowedDraftId, rejectedDraftId]),
        );
      expect(events).toEqual([{ documentId: allowedDraftId }]);
      expect(queuedMessages).toHaveLength(1);
      expect(JSON.stringify(queuedMessages)).toContain(allowedDraftId);
      expect(JSON.stringify(queuedMessages)).not.toContain(rejectedDraftId);
    },
  );

  it("returns the same generic 404 for foreign detail, issue, void, PDF and series mutation", async () => {
    const foreignClientId = await seedClient(
      foreignTenant,
      "Cliente extranjero",
    );
    const foreignSeriesId = await seedSeries(
      foreignTenant,
      "FOREIGN-",
      2,
      true,
    );
    const foreignDraftId = await seedDocument({
      tenant: foreignTenant,
      clientId: foreignClientId,
      status: "draft",
    });
    await seedLine(foreignDraftId);
    const foreignIssuedId = await seedDocument({
      tenant: foreignTenant,
      clientId: foreignClientId,
      seriesId: foreignSeriesId,
      number: 1,
      status: "issued",
      pdfStatus: "pending",
    });

    const responses = await Promise.all([
      getDocument(
        authenticatedRequest(owner, `/api/v1/documents/${foreignDraftId}`),
        routeContext(foreignDraftId),
      ),
      issueDocument(
        authenticatedRequest(
          owner,
          `/api/v1/documents/${foreignDraftId}/issue`,
          { method: "POST" },
        ),
        routeContext(foreignDraftId),
      ),
      voidDocument(
        authenticatedRequest(
          owner,
          `/api/v1/documents/${foreignIssuedId}/void`,
          { method: "POST" },
        ),
        routeContext(foreignIssuedId),
      ),
      getDocumentPdf(
        authenticatedRequest(owner, `/api/v1/documents/${foreignIssuedId}/pdf`),
        routeContext(foreignIssuedId),
      ),
      patchSeries(
        authenticatedRequest(owner, `/api/v1/series/${foreignSeriesId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_default: true }),
        }),
        routeContext(foreignSeriesId),
      ),
    ]);

    for (const response of responses) {
      await expectNotFound(response);
    }
  });
});
