import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-catalog-snapshot-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { POST: createCatalogItem } = await import(
  "@/app/api/v1/catalog-items/route"
);
const { PATCH: patchCatalogItem, DELETE: archiveCatalogItem } = await import(
  "@/app/api/v1/catalog-items/[id]/route"
);
const { POST: createDocument } = await import("@/app/api/v1/documents/route");
const { GET: getDocument } = await import("@/app/api/v1/documents/[id]/route");

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
  const email = `catalog-snapshot-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Catalog Snapshot",
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

describe("catalog items are decoupled from the document lines that copied them", () => {
  let owner: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
  });

  it("keeps a draft line unchanged after the catalog item is edited and archived", async () => {
    const createdItem = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Hora de consultoría",
          unit_price_cents: 6_000,
          tax_rate: "21.00",
        }),
      }),
    );
    const item = await jsonRecord(createdItem);

    // The catalog picker copies these values into the line at selection
    // time; there is no foreign key from document_line to catalog_item.
    const createdDocument = await createDocument(
      authenticatedRequest(owner, "/api/v1/documents", {
        method: "POST",
        body: JSON.stringify({
          doc_type: "invoice",
          lines: [
            {
              description: item.description,
              quantity: "1",
              unit_price_cents: item.unit_price_cents,
              tax_rate: item.tax_rate,
            },
          ],
        }),
      }),
    );
    const document = await jsonRecord(createdDocument);
    const documentId = document.id as string;

    await patchCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: "Hora de consultoría (precio actualizado)",
          unit_price_cents: 9_000,
        }),
      }),
      routeContext(item.id as string),
    );
    await archiveCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${item.id}`, {
        method: "DELETE",
      }),
      routeContext(item.id as string),
    );

    const detailResponse = await getDocument(
      authenticatedRequest(owner, `/api/v1/documents/${documentId}`),
      routeContext(documentId),
    );
    const detail = await jsonRecord(detailResponse);
    const lines = detail.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Hora de consultoría",
      unit_price_cents: 6_000,
    });
  });
});
