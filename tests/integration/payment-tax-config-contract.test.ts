import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIntegrationDatabase } from "./database";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  jsonBody,
  routeContext,
  type Tenant,
} from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const methods = await import("@/app/api/v1/collection-methods/route");
const method = await import("@/app/api/v1/collection-methods/[id]/route");
const taxes = await import("@/app/api/v1/tax-rates/route");
const tax = await import("@/app/api/v1/tax-rates/[id]/route");
const units = await import("@/app/api/v1/units/route");

let owner: Tenant;
let foreign: Tenant;

function post(tenant: Tenant, path: string, body: unknown): Request {
  return authenticatedRequest(tenant, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function patch(tenant: Tenant, path: string, body: unknown): Request {
  return authenticatedRequest(tenant, path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  setAuthEmailDeliveryHandler(() => Promise.resolve());
  owner = await createTenant(auth, database);
  foreign = await createTenant(auth, database);
});

describe("collection methods", () => {
  it("creates kinds with their own rules and keeps a single default", async () => {
    const bank = await methods.POST(
      post(owner, "/api/v1/collection-methods", {
        kind: "bank_account",
        label: "Cuenta principal",
        holder_name: "Estudio Norte, S.L.",
        iban: "es91 2100 0418 4502 0005 1332",
        bic: "caixesbb",
      }),
    );
    expect(bank.status).toBe(201);
    const bankBody = await jsonBody(bank);
    expect(bankBody).toMatchObject({
      kind: "bank_account",
      iban: "ES9121000418450200051332",
      bic: "CAIXESBB",
      is_default: true,
    });

    const second = await methods.POST(
      post(owner, "/api/v1/collection-methods", {
        kind: "bank_account",
        label: "Cuenta secundaria",
        holder_name: "Estudio Norte, S.L.",
        iban: "DE89370400440532013000",
        is_default: true,
      }),
    );
    const bizum = await methods.POST(
      post(owner, "/api/v1/collection-methods", {
        kind: "bizum",
        label: "Bizum",
        phone: "600 123 456",
      }),
    );
    expect(second.status).toBe(201);
    expect(bizum.status).toBe(201);

    const list = await jsonBody(
      await methods.GET(
        authenticatedRequest(owner, "/api/v1/collection-methods"),
      ),
    );
    const items = list.items as Array<Record<string, unknown>>;
    expect(items.filter((item) => item.is_default)).toEqual([
      expect.objectContaining({ label: "Cuenta secundaria" }),
    ]);
  });

  it("rejects an invalid IBAN with iban_invalid and never echoes it", async () => {
    const response = await methods.POST(
      post(owner, "/api/v1/collection-methods", {
        kind: "bank_account",
        label: "Mal",
        holder_name: "X",
        iban: "ES9121000418450200051333",
      }),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("iban_invalid");
    expect(text).not.toContain("0418");
  });

  it("requires kind-specific data", async () => {
    const response = await methods.POST(
      post(owner, "/api/v1/collection-methods", {
        kind: "other",
        label: "Otro",
      }),
    );
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).error).toMatchObject({
      code: "validation_error",
    });
  });

  it("archives and restores, and hides foreign methods behind 404", async () => {
    const created = await jsonBody(
      await methods.POST(
        post(owner, "/api/v1/collection-methods", {
          kind: "cash",
          label: "Efectivo",
        }),
      ),
    );
    const id = created.id as string;
    const archived = await method.PATCH(
      patch(owner, `/api/v1/collection-methods/${id}`, { archived: true }),
      routeContext({ id }),
    );
    const archivedBody = await jsonBody(archived);
    expect(archivedBody).toMatchObject({ is_default: false });
    expect(archivedBody.archived_at).toBeTruthy();
    const active = await jsonBody(
      await methods.GET(
        authenticatedRequest(
          owner,
          "/api/v1/collection-methods?archived=false",
        ),
      ),
    );
    expect(active.items).toEqual([]);

    const restored = await method.PATCH(
      patch(owner, `/api/v1/collection-methods/${id}`, { archived: false }),
      routeContext({ id }),
    );
    expect((await jsonBody(restored)).archived_at).toBeNull();

    const foreignResponse = await method.PATCH(
      patch(foreign, `/api/v1/collection-methods/${id}`, { label: "x" }),
      routeContext({ id }),
    );
    expect(foreignResponse.status).toBe(404);
  });
});

describe("tax rates", () => {
  it("lists the seeded IVA types and adds custom ones with two decimals", async () => {
    const seeded = await jsonBody(
      await taxes.GET(authenticatedRequest(owner, "/api/v1/tax-rates")),
    );
    expect(
      (seeded.items as Array<Record<string, unknown>>).map((item) => [
        item.name,
        item.rate,
        item.is_default,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["IVA", "21.00", true],
        ["IVA", "10.00", false],
        ["IVA", "4.00", false],
        ["IVA", "0.00", false],
      ]),
    );

    const igi = await taxes.POST(
      post(owner, "/api/v1/tax-rates", { name: "IGI", rate: "4,5" }),
    );
    expect(igi.status).toBe(201);
    expect(await jsonBody(igi)).toMatchObject({ name: "IGI", rate: "4.50" });

    const duplicate = await taxes.POST(
      post(owner, "/api/v1/tax-rates", { name: "IGI", rate: 4.5 }),
    );
    expect(duplicate.status).toBe(409);

    const invalid = await taxes.POST(
      post(owner, "/api/v1/tax-rates", { name: "X", rate: "4.555" }),
    );
    expect(invalid.status).toBe(400);
  });

  it("keeps one default and refuses to archive it", async () => {
    const created = await jsonBody(
      await taxes.POST(
        post(owner, "/api/v1/tax-rates", {
          name: "IGIC",
          rate: "7",
          is_default: true,
        }),
      ),
    );
    const id = created.id as string;
    const list = await jsonBody(
      await taxes.GET(authenticatedRequest(owner, "/api/v1/tax-rates")),
    );
    expect(
      (list.items as Array<Record<string, unknown>>).filter(
        (item) => item.is_default,
      ),
    ).toEqual([expect.objectContaining({ name: "IGIC", rate: "7.00" })]);

    const archive = await tax.PATCH(
      patch(owner, `/api/v1/tax-rates/${id}`, { archived: true }),
      routeContext({ id }),
    );
    expect(archive.status).toBe(409);

    const foreignResponse = await tax.PATCH(
      patch(foreign, `/api/v1/tax-rates/${id}`, { name: "Y" }),
      routeContext({ id }),
    );
    expect(foreignResponse.status).toBe(404);
  });
});

describe("units", () => {
  it("returns predefined units plus case-insensitive unique custom ones", async () => {
    const first = await units.POST(
      post(owner, "/api/v1/units", { name: "Palé" }),
    );
    const again = await units.POST(
      post(owner, "/api/v1/units", { name: "palé" }),
    );
    const predefined = await units.POST(
      post(owner, "/api/v1/units", { name: "Hora" }),
    );
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await jsonBody(predefined)).toEqual({ id: null, name: "hora" });

    const list = await jsonBody(
      await units.GET(authenticatedRequest(owner, "/api/v1/units")),
    );
    expect(list.predefined).toContain("hora");
    expect(list.custom).toEqual([expect.objectContaining({ name: "Palé" })]);
    const foreignList = await jsonBody(
      await units.GET(authenticatedRequest(foreign, "/api/v1/units")),
    );
    expect(foreignList.custom).toEqual([]);
  });
});
