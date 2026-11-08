import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogItems, clients } from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  type Tenant,
} from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: listClients, POST: createClient } = await import(
  "@/app/api/v1/clients/route"
);
const { GET: listCatalog } = await import("@/app/api/v1/catalog-items/route");

beforeEach(() => {
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

async function names(tenant: Tenant, path: string): Promise<string[]> {
  const response = await (path.startsWith("/api/v1/clients")
    ? listClients
    : listCatalog)(authenticatedRequest(tenant, path));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    items: Array<{ name?: string; description?: string }>;
  };
  return body.items.map((item) => item.name ?? item.description ?? "");
}

async function seedClients(tenant: Tenant) {
  const base = { companyId: tenant.companyId };
  await database.insert(clients).values([
    {
      ...base,
      id: crypto.randomUUID(),
      name: "Ángela Muñoz Diseño",
      taxId: "12345678Z",
      email: "angela@estudio.example",
      phone: "+34 600 111 222",
      address: "Calle Mayor 3",
      postalCode: "41001",
      city: "Sevilla",
    },
    {
      ...base,
      id: crypto.randomUUID(),
      name: "Talleres Pérez, S.L.",
      taxId: "B87654321",
      email: "admin@talleres.example",
      phone: "910 000 000",
      address: "Polígono Sur, nave 4",
      postalCode: "28021",
      city: "Madrid",
    },
    {
      ...base,
      id: crypto.randomUUID(),
      name: "Descuentos 50% S.A.",
      city: "Málaga",
    },
  ]);
}

describe("accent- and case-insensitive search", () => {
  it.each([
    ["angela", "Ángela Muñoz Diseño"],
    ["MUNOZ", "Ángela Muñoz Diseño"],
    ["12345678z", "Ángela Muñoz Diseño"],
    ["estudio.example", "Ángela Muñoz Diseño"],
    ["600 111", "Ángela Muñoz Diseño"],
    ["calle mayor", "Ángela Muñoz Diseño"],
    ["41001", "Ángela Muñoz Diseño"],
    ["sevilla", "Ángela Muñoz Diseño"],
    ["perez", "Talleres Pérez, S.L."],
    ["poligono", "Talleres Pérez, S.L."],
    ["malaga", "Descuentos 50% S.A."],
  ])("finds clients by «%s»", async (query, expected) => {
    const tenant = await createTenant(auth, database);
    await seedClients(tenant);
    expect(
      await names(tenant, `/api/v1/clients?q=${encodeURIComponent(query)}`),
    ).toEqual([expected]);
  });

  it("treats LIKE wildcards literally", async () => {
    const tenant = await createTenant(auth, database);
    await seedClients(tenant);
    expect(await names(tenant, "/api/v1/clients?q=50%25")).toEqual([
      "Descuentos 50% S.A.",
    ]);
    expect(await names(tenant, "/api/v1/clients?q=_")).toEqual([]);
  });

  it("never returns another company's clients", async () => {
    const tenant = await createTenant(auth, database);
    const other = await createTenant(auth, database);
    await seedClients(other);
    expect(await names(tenant, "/api/v1/clients?q=sevilla")).toEqual([]);
  });

  it("stores and searches the postal code and city sent by the API", async () => {
    const tenant = await createTenant(auth, database);
    const response = await createClient(
      authenticatedRequest(tenant, "/api/v1/clients", {
        method: "POST",
        body: JSON.stringify({
          name: "Clínica Dental Íñigo",
          postal_code: "48001",
          city: "Bilbao",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      postal_code: "48001",
      city: "Bilbao",
    });
    expect(await names(tenant, "/api/v1/clients?q=inigo")).toEqual([
      "Clínica Dental Íñigo",
    ]);
    expect(await names(tenant, "/api/v1/clients?q=48001")).toEqual([
      "Clínica Dental Íñigo",
    ]);
  });

  it("searches the catalog without accents", async () => {
    const tenant = await createTenant(auth, database);
    await database.insert(catalogItems).values([
      {
        id: crypto.randomUUID(),
        companyId: tenant.companyId,
        description: "Revisión técnica anual",
        unitPriceCents: 5_000,
        taxRate: "21.00",
      },
      {
        id: crypto.randomUUID(),
        companyId: tenant.companyId,
        description: "Hora de consultoría",
        unitPriceCents: 6_000,
        taxRate: "21.00",
      },
    ]);
    expect(await names(tenant, "/api/v1/catalog-items?q=REVISION")).toEqual([
      "Revisión técnica anual",
    ]);
    expect(await names(tenant, "/api/v1/catalog-items?q=consultoria")).toEqual([
      "Hora de consultoría",
    ]);
  });
});
