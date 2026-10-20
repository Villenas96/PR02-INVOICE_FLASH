import { readFile } from "node:fs/promises";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogItems, importJobs } from "@/db/schema";
import { jobMessageSchema } from "@/workers/messages";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
  type Tenant,
} from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

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
const { POST: upload } = await import("@/app/api/v1/imports/route");
const { GET: getImportRoute } = await import("@/app/api/v1/imports/[id]/route");
const { POST: confirm } = await import(
  "@/app/api/v1/imports/[id]/confirm/route"
);
const { analyzeImport, applyImport } = await import("@/services/imports");

let bucket: InMemoryBucket;
let jobs: ReturnType<typeof recordingQueue>;

beforeEach(() => {
  bucket = new InMemoryBucket();
  jobs = recordingQueue();
  cloudflareState.env = { STORAGE_BUCKET: bucket, JOBS_QUEUE: jobs };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

function csvFile(content: Uint8Array | string, name = "catalogo.csv"): File {
  return new File([content as BlobPart], name, { type: "text/csv" });
}

async function uploadCsv(tenant: Tenant, file: File): Promise<Response> {
  const form = new FormData();
  form.set("kind", "catalog");
  form.set("file", file);
  return upload(
    authenticatedRequest(tenant, "/api/v1/imports", {
      method: "POST",
      body: form,
    }),
  );
}

async function importStatus(tenant: Tenant, id: string) {
  const response = await getImportRoute(
    authenticatedRequest(tenant, `/api/v1/imports/${id}`),
    routeContext({ id }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    status: string;
    error_code: string | null;
    preview: {
      headers: string[];
      encoding: string;
      suggested_mapping: Record<string, number | null>;
      summary: {
        rows: number;
        valid: number;
        errored: number;
        duplicates: number;
      };
      errors: Array<{ line: number; field: string }>;
    } | null;
    result: {
      created: number;
      updated: number;
      skipped: number;
      errored: number;
    } | null;
  };
}

async function uploadAndAnalyze(tenant: Tenant, file: File): Promise<string> {
  const response = await uploadCsv(tenant, file);
  expect(response.status, await response.clone().text()).toBe(202);
  const { import_id: id } = (await response.json()) as { import_id: string };
  const message = jobMessageSchema.parse(jobs.messages.at(-1));
  expect(message).toMatchObject({ type: "import.analyze", importJobId: id });
  await analyzeImport(id, { database, bucket });
  return id;
}

async function confirmImport(
  tenant: Tenant,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return confirm(
    authenticatedRequest(tenant, `/api/v1/imports/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    routeContext({ id }),
  );
}

async function catalogOf(tenant: Tenant) {
  return database
    .select({
      description: catalogItems.description,
      unitPriceCents: catalogItems.unitPriceCents,
      taxRate: catalogItems.taxRate,
      unit: catalogItems.unit,
      sourceImportId: catalogItems.sourceImportId,
    })
    .from(catalogItems)
    .where(eq(catalogItems.companyId, tenant.companyId));
}

const MAPPING = { description: 0, unit_price: 1, tax_rate: 2, unit: 3 };

describe("catalog CSV import", () => {
  it("analyzes a Windows-1252 `;` file without creating anything", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const bytes = new Uint8Array(
      await readFile("tests/fixtures/csv/catalog-latin1-semicolon.csv"),
    );
    const id = await uploadAndAnalyze(tenant, csvFile(bytes));

    const status = await importStatus(tenant, id);
    expect(status.status).toBe("preview_ready");
    expect(status.preview?.encoding).toBe("windows-1252");
    expect(status.preview?.headers[0]).toBe("Descripción");
    expect(status.preview?.suggested_mapping).toEqual(MAPPING);
    expect(status.preview?.summary.rows).toBeGreaterThan(0);
    expect(await catalogOf(tenant)).toEqual([]);
  });

  it("reports row errors and applies with `skip` duplicates", async () => {
    const tenant = await createTenant(auth, database, "pro");
    await database.insert(catalogItems).values({
      id: crypto.randomUUID(),
      companyId: tenant.companyId,
      description: "Hora de diseño",
      unitPriceCents: 4_000,
      taxRate: "21.00",
    });
    const id = await uploadAndAnalyze(
      tenant,
      csvFile(
        [
          "descripcion;precio;iva;unidad",
          "HORA DE DISENO;45,00;21;hora",
          "Revisión anual;1.200,50;10;",
          ";12,00;21;",
          "Taller;-5;21;",
          "Revisión anual;99,00;21;",
        ].join("\n"),
      ),
    );
    const preview = (await importStatus(tenant, id)).preview;
    expect(preview?.summary).toEqual({
      rows: 5,
      valid: 3,
      errored: 2,
      duplicates: 2,
    });
    expect(preview?.errors.map((error) => [error.line, error.field])).toEqual([
      [4, "description"],
      [5, "unit_price"],
    ]);

    const confirmed = await confirmImport(tenant, id, {
      mapping: MAPPING,
      duplicate_policy: "skip",
    });
    expect(confirmed.status).toBe(202);
    await applyImport(id, { database, bucket });

    const status = await importStatus(tenant, id);
    expect(status.status).toBe("done");
    expect(status.result).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 2,
      errored: 2,
    });
    const items = await catalogOf(tenant);
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(
      expect.objectContaining({
        description: "Hora de diseño",
        unitPriceCents: 4_000,
        sourceImportId: null,
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        description: "Revisión anual",
        unitPriceCents: 120_050,
        taxRate: "10.00",
        sourceImportId: id,
      }),
    );
  });

  it("updates existing products with `update`", async () => {
    const tenant = await createTenant(auth, database, "pro");
    await database.insert(catalogItems).values({
      id: crypto.randomUUID(),
      companyId: tenant.companyId,
      description: "Hora de diseño",
      unitPriceCents: 4_000,
      taxRate: "21.00",
    });
    const id = await uploadAndAnalyze(
      tenant,
      csvFile("descripcion,precio,iva,unidad\nHora de diseño,50.00,21,hora\n"),
    );
    await confirmImport(tenant, id, {
      mapping: MAPPING,
      duplicate_policy: "update",
    });
    await applyImport(id, { database, bucket });
    expect((await importStatus(tenant, id)).result).toMatchObject({
      created: 0,
      updated: 1,
    });
    expect(await catalogOf(tenant)).toEqual([
      expect.objectContaining({
        description: "Hora de diseño",
        unitPriceCents: 5_000,
        unit: "hora",
        sourceImportId: id,
      }),
    ]);
  });

  it("rejects files over 5.000 rows or 5 MB with import_too_large", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const big = new Uint8Array(
      await readFile("tests/fixtures/csv/catalog-5001.csv"),
    );
    const id = await uploadAndAnalyze(tenant, csvFile(big));
    expect(await importStatus(tenant, id)).toMatchObject({
      status: "rejected",
      error_code: "import_too_large",
    });

    const tooHeavy = await uploadCsv(
      tenant,
      csvFile(new Uint8Array(5 * 1024 * 1024 + 1)),
    );
    expect(tooHeavy.status).toBe(400);
    expect(await tooHeavy.json()).toMatchObject({
      error: { code: "import_too_large" },
    });
  });

  it.each(["basic", "essential"] as const)(
    "is Pro only (%s → 403)",
    async (plan) => {
      const tenant = await createTenant(auth, database, plan);
      const response = await uploadCsv(
        tenant,
        csvFile("descripcion;precio\nA;1\n"),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: {
          code: "feature_not_in_plan",
          details: { feature: "catalog_import" },
        },
      });
    },
  );

  it("never duplicates products when the apply job is redelivered", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const lines = ["descripcion;precio;iva;unidad"];
    for (let index = 1; index <= 1_200; index += 1) {
      lines.push(`Producto ${index};${index},00;21;unidad`);
    }
    const id = await uploadAndAnalyze(tenant, csvFile(lines.join("\n")));
    await confirmImport(tenant, id, {
      mapping: MAPPING,
      duplicate_policy: "skip",
    });

    // Two concurrent deliveries, then a late redelivery once done.
    await Promise.all([
      applyImport(id, { database, bucket }),
      applyImport(id, { database, bucket }),
    ]);
    await applyImport(id, { database, bucket });

    const [job] = await database
      .select({ status: importJobs.status, result: importJobs.result })
      .from(importJobs)
      .where(eq(importJobs.id, id));
    expect(job?.status).toBe("done");
    expect(job?.result).toMatchObject({
      created: 1_200,
      skipped: 0,
      next_row: 1_200,
    });
    const created = await database
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.companyId, tenant.companyId),
          eq(catalogItems.sourceImportId, id),
        ),
      );
    expect(created).toHaveLength(1_200);
  });

  it("only confirms from preview_ready and with a complete mapping", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const id = await uploadAndAnalyze(
      tenant,
      csvFile("descripcion;precio\nA;1\n"),
    );
    const incomplete = await confirmImport(tenant, id, {
      mapping: { description: 0, unit_price: null, tax_rate: null, unit: null },
      duplicate_policy: "skip",
    });
    expect(incomplete.status).toBe(400);

    const valid = {
      mapping: { description: 0, unit_price: 1, tax_rate: null, unit: null },
      duplicate_policy: "skip",
    };
    expect((await confirmImport(tenant, id, valid)).status).toBe(202);
    expect((await confirmImport(tenant, id, valid)).status).toBe(409);
  });
});
