import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-catalog-contract-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL = appBaseUrl;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getCatalogItems, POST: createCatalogItem } = await import(
  "@/app/api/v1/catalog-items/route"
);
const { PATCH: patchCatalogItem, DELETE: archiveCatalogItem } = await import(
  "@/app/api/v1/catalog-items/[id]/route"
);
const { POST: restoreCatalogItem } = await import(
  "@/app/api/v1/catalog-items/[id]/restore/route"
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
  const email = `catalog-contract-${suffix}@example.test`;
  const now = new Date();
  const signUpResponse = await auth.handler(
    new Request(`${appBaseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Catalog Contract",
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
    legalName: "Empresa Catálogo, S.L.",
    taxId: "B12345678",
    address: "Calle del Catálogo 1, Madrid",
    email,
    defaultTaxRate: "21.00",
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

describe("catalog items HTTP contract", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    setAuthEmailDeliveryHandler(() => Promise.resolve());
    owner = await createTenant();
    foreignTenant = await createTenant();
  });

  it("rejects an invalid catalog item body", async () => {
    const response = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({ description: "", unit_price_cents: -1 }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await jsonRecord(response)).error).toMatchObject({
      code: "validation_error",
    });
  });

  it("defaults the tax rate to the company's own default", async () => {
    const response = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Consultoría técnica",
          unit_price_cents: 5_000,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await jsonRecord(response)).toMatchObject({ tax_rate: "21.00" });
  });

  it("searches by description and excludes archived items from the default listing", async () => {
    const found = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Diseño de logotipo",
          unit_price_cents: 15_000,
        }),
      }),
    );
    const foundBody = await jsonRecord(found);
    const other = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Mantenimiento web",
          unit_price_cents: 8_000,
        }),
      }),
    );
    const otherBody = await jsonRecord(other);

    await archiveCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${otherBody.id}`, {
        method: "DELETE",
      }),
      routeContext(otherBody.id as string),
    );

    const searchResponse = await getCatalogItems(
      authenticatedRequest(owner, "/api/v1/catalog-items?q=logotipo"),
    );
    const searchBody = await jsonRecord(searchResponse);
    expect(searchBody.items).toEqual([
      expect.objectContaining({ id: foundBody.id }),
    ]);

    const defaultResponse = await getCatalogItems(
      authenticatedRequest(owner, "/api/v1/catalog-items"),
    );
    const defaultBody = await jsonRecord(defaultResponse);
    expect(
      (defaultBody.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([foundBody.id]);

    const archivedResponse = await getCatalogItems(
      authenticatedRequest(owner, "/api/v1/catalog-items?archived=true"),
    );
    const archivedBody = await jsonRecord(archivedResponse);
    expect(
      (archivedBody.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([otherBody.id]);
  });

  it("edits an item and toggles archive/restore reversibly", async () => {
    const created = await createCatalogItem(
      authenticatedRequest(owner, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Servicio editable",
          unit_price_cents: 1_000,
        }),
      }),
    );
    const itemId = (await jsonRecord(created)).id as string;

    const patchResponse = await patchCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ unit_price_cents: 2_000 }),
      }),
      routeContext(itemId),
    );
    expect(patchResponse.status).toBe(200);
    expect(await jsonRecord(patchResponse)).toMatchObject({
      unit_price_cents: 2_000,
    });

    const archiveResponse = await archiveCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${itemId}`, {
        method: "DELETE",
      }),
      routeContext(itemId),
    );
    expect(archiveResponse.status).toBe(200);
    expect((await jsonRecord(archiveResponse)).archived_at).not.toBeNull();

    const restoreResponse = await restoreCatalogItem(
      authenticatedRequest(owner, `/api/v1/catalog-items/${itemId}/restore`, {
        method: "POST",
      }),
      routeContext(itemId),
    );
    expect(restoreResponse.status).toBe(200);
    expect((await jsonRecord(restoreResponse)).archived_at).toBeNull();
  });

  it("returns 404 for every foreign catalog item operation", async () => {
    const created = await createCatalogItem(
      authenticatedRequest(foreignTenant, "/api/v1/catalog-items", {
        method: "POST",
        body: JSON.stringify({
          description: "Concepto ajeno",
          unit_price_cents: 1_000,
        }),
      }),
    );
    const foreignItemId = (await jsonRecord(created)).id as string;

    const responses = await Promise.all([
      patchCatalogItem(
        authenticatedRequest(owner, `/api/v1/catalog-items/${foreignItemId}`, {
          method: "PATCH",
          body: JSON.stringify({ unit_price_cents: 500 }),
        }),
        routeContext(foreignItemId),
      ),
      archiveCatalogItem(
        authenticatedRequest(owner, `/api/v1/catalog-items/${foreignItemId}`, {
          method: "DELETE",
        }),
        routeContext(foreignItemId),
      ),
      restoreCatalogItem(
        authenticatedRequest(
          owner,
          `/api/v1/catalog-items/${foreignItemId}/restore`,
          { method: "POST" },
        ),
        routeContext(foreignItemId),
      ),
    ]);

    for (const response of responses) {
      await expectNotFound(response);
    }
  });
});
