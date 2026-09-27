import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { clients, companies, documents, users } from "@/db/schema";

import {
  createIntegrationDatabase,
  truncateIntegrationDatabase,
} from "../integration/database";
import {
  CLIENT_COUNT,
  DOCUMENT_COUNT,
  generateClientFixtures,
  generateDocumentFixtures,
} from "./fixtures/api-crud";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-api-crud-perf-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getClients, POST: createClient } = await import(
  "@/app/api/v1/clients/route"
);
const { GET: getClient, PATCH: patchClient } = await import(
  "@/app/api/v1/clients/[id]/route"
);
const { GET: getDocuments, POST: createDocument } = await import(
  "@/app/api/v1/documents/route"
);
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");

const CRUD_P95_MS = 300;
const ITERATIONS = 20;
const INSERT_BATCH_SIZE = 500;

function percentile(durationsMs: number[], p: number): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

async function measure(action: () => Promise<Response>): Promise<number> {
  const startedAt = performance.now();
  const response = await action();
  const duration = performance.now() - startedAt;
  expect(response.status).toBeLessThan(400);
  return duration;
}

function authenticatedRequest(
  cookie: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`${appBaseUrl}${path}`, { ...init, headers });
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

interface Fixture {
  cookie: string;
  clientIds: string[];
  documentIds: string[];
}

/**
 * Seeds one company with 200 clients and 300 issued documents (bulk insert,
 * bypassing the atomic issuance guard purely to reach a representative
 * at-scale dataset) once for the whole suite, then every `it()` measures a
 * distinct CRUD operation against that same fixed dataset.
 */
async function seedFixture(): Promise<Fixture> {
  await truncateIntegrationDatabase();
  const now = new Date();
  const email = `perf-crud-${crypto.randomUUID()}@example.test`;
  const password = "invoice-flash-perf-password";

  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rendimiento CRUD", email, password }),
    }),
  );
  expect(signUpResponse.status).toBe(200);
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    throw new Error("No se ha creado el usuario de rendimiento.");
  }
  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, user.id));
  const signInResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(signInResponse.status).toBe(200);
  const cookie = sessionCookie(signInResponse);

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId: user.id,
    legalName: "Empresa Rendimiento CRUD, S.L.",
    taxId: "B12345678",
    address: "Calle del Rendimiento 1, Madrid",
    email,
    createdAt: now,
    updatedAt: now,
  });

  const clientFixtures = generateClientFixtures(CLIENT_COUNT);
  for (
    let offset = 0;
    offset < clientFixtures.length;
    offset += INSERT_BATCH_SIZE
  ) {
    const batch = clientFixtures.slice(offset, offset + INSERT_BATCH_SIZE);
    await database.insert(clients).values(
      batch.map((row) => ({
        id: row.id,
        companyId,
        name: row.name,
        taxId: row.taxId,
      })),
    );
  }
  const clientIds = clientFixtures.map((row) => row.id);

  const documentFixtures = generateDocumentFixtures(clientIds, DOCUMENT_COUNT);
  for (
    let offset = 0;
    offset < documentFixtures.length;
    offset += INSERT_BATCH_SIZE
  ) {
    const batch = documentFixtures.slice(offset, offset + INSERT_BATCH_SIZE);
    await database.insert(documents).values(
      batch.map((row) => ({
        id: row.id,
        companyId,
        documentType: "invoice" as const,
        status: "issued" as const,
        number: row.number,
        fullNumber: row.fullNumber,
        clientId: row.clientId,
        issueDate: now.toISOString().slice(0, 10),
        totalCents: row.totalCents,
        pdfStatus: "ready" as const,
        issuerSnapshot: { legalName: "Empresa Rendimiento CRUD, S.L." },
        clientSnapshot: { name: "Cliente" },
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  return {
    cookie,
    clientIds,
    documentIds: documentFixtures.map((row) => row.id),
  };
}

describe("API CRUD performance", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    fixture = await seedFixture();
  }, 60_000);

  it(`creates a client with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      durations.push(
        await measure(() =>
          createClient(
            authenticatedRequest(fixture.cookie, "/api/v1/clients", {
              method: "POST",
              body: JSON.stringify({
                name: `Cliente Rendimiento Creado ${index}`,
              }),
            }),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`lists a page of ${CLIENT_COUNT} clients with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      durations.push(
        await measure(() =>
          getClients(authenticatedRequest(fixture.cookie, "/api/v1/clients")),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`reads a single client with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      const clientId = fixture.clientIds[
        index % fixture.clientIds.length
      ] as string;
      durations.push(
        await measure(() =>
          getClient(
            authenticatedRequest(fixture.cookie, `/api/v1/clients/${clientId}`),
            routeContext(clientId),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`updates a client with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      const clientId = fixture.clientIds[
        index % fixture.clientIds.length
      ] as string;
      durations.push(
        await measure(() =>
          patchClient(
            authenticatedRequest(
              fixture.cookie,
              `/api/v1/clients/${clientId}`,
              {
                method: "PATCH",
                body: JSON.stringify({ notes: `Actualizado ${index}` }),
              },
            ),
            routeContext(clientId),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`creates a draft document with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      const clientId = fixture.clientIds[
        index % fixture.clientIds.length
      ] as string;
      durations.push(
        await measure(() =>
          createDocument(
            authenticatedRequest(fixture.cookie, "/api/v1/documents", {
              method: "POST",
              body: JSON.stringify({
                doc_type: "invoice",
                client_id: clientId,
                lines: [
                  {
                    description: "Servicio de rendimiento",
                    quantity: "1",
                    unit_price_cents: 10_000,
                    tax_rate: "21.00",
                  },
                ],
              }),
            }),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`lists a page of ${DOCUMENT_COUNT} documents with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      durations.push(
        await measure(() =>
          getDocuments(
            authenticatedRequest(fixture.cookie, "/api/v1/documents"),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });

  it(`reads a single document with p95 under ${CRUD_P95_MS} ms`, async () => {
    const durations: number[] = [];
    for (let index = 0; index < ITERATIONS; index += 1) {
      const documentId = fixture.documentIds[
        index % fixture.documentIds.length
      ] as string;
      durations.push(
        await measure(() =>
          getDocument(
            authenticatedRequest(
              fixture.cookie,
              `/api/v1/documents/${documentId}`,
            ),
            routeContext(documentId),
          ),
        ),
      );
    }
    expect(percentile(durations, 95)).toBeLessThan(CRUD_P95_MS);
  });
});
