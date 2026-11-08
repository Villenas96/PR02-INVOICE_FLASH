import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";

import {
  companies,
  documents,
  emailDeliveries,
  exportJobs,
  payments,
} from "@/db/schema";
import { hashDownloadToken } from "@/lib/download-tokens";
import { resolvePeriod } from "@/lib/exports/period";
import { jobMessageSchema } from "@/workers/messages";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  type Tenant,
} from "./http";

const SECRET = "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_SECRET = SECRET;
process.env.BETTER_AUTH_URL = APP_BASE_URL;
process.env.APP_BASE_URL = APP_BASE_URL;

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
const { POST: createExportRoute } = await import("@/app/api/v1/exports/route");
const { buildExport, getExport } = await import("@/services/exports");
const { renderNotice } = await import("@/workers/handlers/notice-email");
const { RetryableQueueError } = await import("@/workers/queue-consumer");

const NOW = new Date("2026-10-20T08:00:00.000Z");
const QUARTER = resolvePeriod("previous_quarter", NOW);

let bucket: InMemoryBucket;
let jobs: ReturnType<typeof recordingQueue>;

beforeEach(() => {
  bucket = new InMemoryBucket();
  jobs = recordingQueue();
  cloudflareState.env = { STORAGE_BUCKET: bucket, JOBS_QUEUE: jobs };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

interface SeedOptions {
  number: number;
  issueDate?: string;
  totalCents?: number;
  paidCents?: number;
  clientId?: string;
  status?: "issued" | "voided";
  pdf?: Uint8Array | null;
}

async function seedInvoice(tenant: Tenant, options: SeedOptions) {
  const id = crypto.randomUUID();
  const total = options.totalCents ?? 12_100;
  const base = Math.round(total / 1.21);
  await database.insert(documents).values({
    id,
    companyId: tenant.companyId,
    documentType: "invoice",
    status: options.status ?? "issued",
    number: options.number,
    fullNumber: `2026-${String(options.number).padStart(4, "0")}`,
    clientId: options.clientId ?? tenant.clientId,
    issueDate: options.issueDate ?? "2026-08-10",
    dueDate: "2026-12-31",
    subtotalCents: base,
    taxBreakdown: [
      { name: "IVA", rate: "21.00", baseCents: base, taxCents: total - base },
    ],
    totalCents: total,
    clientSnapshot: { name: "Cliente de contrato, S.A.", taxId: "A87654321" },
    pdfStatus: options.pdf === null ? "pending" : "ready",
  });
  if (options.pdf !== null) {
    await bucket.put(
      `documents/${id}/pdf/v1.pdf`,
      options.pdf ?? new TextEncoder().encode(`%PDF ${options.number}`),
    );
  }
  if (options.paidCents) {
    await database.insert(payments).values({
      id: crypto.randomUUID(),
      companyId: tenant.companyId,
      documentId: id,
      amountCents: options.paidCents,
      paidOn: "2026-09-01",
      method: "transfer",
    });
  }
  return id;
}

async function requestExport(tenant: Tenant, body: unknown) {
  return createExportRoute(
    authenticatedRequest(tenant, "/api/v1/exports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

function build(id: string, overrides: { now?: Date } = {}) {
  return buildExport(id, {
    database,
    bucket,
    pdfQueue: jobs,
    emailQueue: jobs,
    secret: SECRET,
    now: overrides.now ?? NOW,
  });
}

async function exportIdFrom(response: Response): Promise<string> {
  expect(response.status, await response.clone().text()).toBe(202);
  return ((await response.json()) as { export_id: string }).export_id;
}

async function readSheet(key: string): Promise<unknown[][]> {
  const object = await bucket.get(key);
  const bytes = new Uint8Array(await new Response(object?.body).arrayBuffer());
  const workbook = read(bytes);
  return utils.sheet_to_json<unknown[]>(
    workbook.Sheets[workbook.SheetNames[0] as string] as never,
    { header: 1 },
  );
}

async function job(id: string) {
  const [row] = await database
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.id, id));
  return row;
}

describe("exports", () => {
  it("period Excel: Essential and Pro only", async () => {
    const basic = await createTenant(auth, database, "basic");
    const denied = await requestExport(basic, {
      kind: "period_excel",
      period: "previous_quarter",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: {
        code: "feature_not_in_plan",
        details: { feature: "period_export" },
      },
    });

    const essential = await createTenant(auth, database, "essential");
    const id = await exportIdFrom(
      await requestExport(essential, {
        kind: "period_excel",
        period: "previous_quarter",
      }),
    );
    expect(jobMessageSchema.parse(jobs.messages.at(-1))).toMatchObject({
      type: "export.build",
      exportJobId: id,
    });
  });

  it("builds one row per document with totals from stored amounts", async () => {
    const tenant = await createTenant(auth, database, "essential");
    const [exportJob] = await database
      .insert(exportJobs)
      .values({
        id: crypto.randomUUID(),
        companyId: tenant.companyId,
        requestedBy: `user:${tenant.userId}`,
        kind: "period_excel",
        filters: {
          types: ["invoice"],
          from: QUARTER.from,
          to: QUARTER.to,
          period_label: QUARTER.label,
        },
        formats: ["xlsx"],
        periodKey: QUARTER.key,
      })
      .returning();
    await seedInvoice(tenant, { number: 1, totalCents: 12_100 });
    await seedInvoice(tenant, {
      number: 2,
      totalCents: 24_200,
      paidCents: 24_200,
    });
    await seedInvoice(tenant, { number: 3, status: "voided" });
    await seedInvoice(tenant, { number: 4, issueDate: "2026-10-02" });

    await build(exportJob?.id as string);
    const ready = await job(exportJob?.id as string);
    expect(ready?.status).toBe("ready");
    const files = ready?.fileKeys as Array<{ key: string; filename: string }>;
    expect(files.map((file) => file.filename)).toEqual([
      `facturas-${QUARTER.key}.xlsx`,
    ]);
    const rows = await readSheet(files[0]?.key as string);
    expect(rows).toHaveLength(3 + 2);
    expect(rows.at(-1)?.[0]).toBe("Total (sin anulados)");
    expect(rows.at(-1)).toContain(363);
    expect(rows[2]).toContain("Pagada");

    const view = await getExport({
      database,
      companyId: tenant.companyId,
      exportId: exportJob?.id as string,
      appBaseUrl: APP_BASE_URL,
      secret: SECRET,
      now: NOW,
    });
    expect(view.files[0]?.url).toMatch(/^http:\/\/localhost:3000\/x\//);
    const token = view.files[0]?.url.split("/x/")[1] as string;
    expect(ready?.downloadTokenHash).toBe(await hashDownloadToken(token));
  });

  it("advanced exports are Pro only and apply every filter", async () => {
    const essential = await createTenant(auth, database, "essential");
    const denied = await requestExport(essential, {
      kind: "advanced",
      types: ["invoice"],
      from: "2026-07-01",
      to: "2026-09-30",
      formats: ["xlsx"],
    });
    expect(denied.status).toBe(403);

    const pro = await createTenant(auth, database, "pro");
    await seedInvoice(pro, { number: 1, paidCents: 12_100 });
    await seedInvoice(pro, { number: 2 });
    const foreign = await createTenant(auth, database, "pro");
    expect(
      (
        await requestExport(pro, {
          kind: "advanced",
          types: ["invoice"],
          from: "2026-07-01",
          to: "2026-09-30",
          client_id: foreign.clientId,
          formats: ["xlsx"],
        })
      ).status,
    ).toBe(404);

    const id = await exportIdFrom(
      await requestExport(pro, {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-07-01",
        to: "2026-09-30",
        status: "paid",
        client_id: pro.clientId,
        formats: ["xlsx"],
      }),
    );
    await build(id);
    const files = (await job(id))?.fileKeys as Array<{ key: string }>;
    const rows = await readSheet(files[0]?.key as string);
    expect(rows).toHaveLength(1 + 2);
    expect(rows[1]?.[1]).toBe("2026-0001");
  });

  it("ends as `empty` when no document matches", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const id = await exportIdFrom(
      await requestExport(tenant, {
        kind: "advanced",
        types: ["invoice"],
        from: "2020-01-01",
        to: "2020-12-31",
        formats: ["xlsx", "pdf_zip"],
      }),
    );
    await build(id);
    expect((await job(id))?.status).toBe("empty");
  });

  it("zips every cached PDF through a ≥ 5 MiB multipart upload", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const big = (seed: number) => {
      const bytes = new Uint8Array(3 * 1024 * 1024);
      bytes.fill(seed);
      return bytes;
    };
    await seedInvoice(tenant, { number: 1, pdf: big(1) });
    await seedInvoice(tenant, { number: 2, pdf: big(2) });
    const id = await exportIdFrom(
      await requestExport(tenant, {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-07-01",
        to: "2026-09-30",
        formats: ["pdf_zip"],
      }),
    );
    await build(id);
    const files = (await job(id))?.fileKeys as Array<{
      key: string;
      content_type: string;
    }>;
    expect(files[0]?.content_type).toBe("application/zip");
    const parts = bucket.multipartParts.get(files[0]?.key as string) ?? [];
    expect(parts.length).toBe(2);
    expect(parts[0]).toBeGreaterThanOrEqual(5 * 1024 * 1024);

    const zip = await bucket.get(files[0]?.key as string);
    const entries = unzipSync(
      new Uint8Array(await new Response(zip?.body).arrayBuffer()),
    );
    expect(Object.keys(entries).sort()).toEqual([
      "2026-0001.pdf",
      "2026-0002.pdf",
    ]);
    expect(entries["2026-0002.pdf"]?.[0]).toBe(2);
  });

  it("waits (retries) while a PDF is not ready, re-queuing the render", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const pendingId = await seedInvoice(tenant, { number: 1, pdf: null });
    const id = await exportIdFrom(
      await requestExport(tenant, {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-07-01",
        to: "2026-09-30",
        formats: ["pdf_zip"],
      }),
    );
    await expect(build(id)).rejects.toBeInstanceOf(RetryableQueueError);
    expect((await job(id))?.status).toBe("running");

    await database
      .update(documents)
      .set({ pdfStatus: "failed" })
      .where(eq(documents.id, pendingId));
    jobs.messages.length = 0;
    await expect(build(id)).rejects.toBeInstanceOf(RetryableQueueError);
    expect(jobs.messages).toContainEqual(
      expect.objectContaining({ type: "pdf.render", documentId: pendingId }),
    );
  });

  it("links expire after 7 days", async () => {
    const tenant = await createTenant(auth, database, "pro");
    await seedInvoice(tenant, { number: 1 });
    const id = await exportIdFrom(
      await requestExport(tenant, {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-07-01",
        to: "2026-09-30",
        formats: ["xlsx"],
      }),
    );
    await build(id);
    const view = (now: Date) =>
      getExport({
        database,
        companyId: tenant.companyId,
        exportId: id,
        appBaseUrl: APP_BASE_URL,
        secret: SECRET,
        now,
      });
    expect((await view(NOW)).files).toHaveLength(1);
    const later = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000 + 1);
    expect((await view(later)).files).toEqual([]);
  });

  it("emails the advisor once, with only the expiring link", async () => {
    const tenant = await createTenant(auth, database, "essential");
    await database
      .update(companies)
      .set({ advisorEmail: "asesoria@example.test" })
      .where(eq(companies.id, tenant.companyId));
    await seedInvoice(tenant, { number: 1 });
    const id = await exportIdFrom(
      await requestExport(tenant, {
        kind: "period_excel",
        period: "previous_quarter",
        send_to_advisor: true,
      }),
    );
    // The period comes from the real clock; align the stored filter.
    await database
      .update(exportJobs)
      .set({
        filters: {
          types: ["invoice"],
          from: QUARTER.from,
          to: QUARTER.to,
          period_label: QUARTER.label,
        },
      })
      .where(eq(exportJobs.id, id));
    await build(id);
    await database
      .update(exportJobs)
      .set({ status: "running" })
      .where(eq(exportJobs.id, id));
    await build(id);

    const deliveries = await database
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.exportJobId, id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      purpose: "advisor_export",
      recipientEmail: "asesoria@example.test",
    });
    expect(JSON.stringify(deliveries[0]?.payload)).not.toMatch(
      /token|cents|B12345678/i,
    );
    const rendered = await renderNotice(
      "advisor_export",
      deliveries[0]?.payload as Record<string, unknown>,
      { appBaseUrl: APP_BASE_URL, tokenSecret: () => SECRET },
    );
    const link = rendered?.text.match(/\/x\/([^\s]+)/)?.[1] as string;
    expect((await job(id))?.downloadTokenHash).toBe(
      await hashDownloadToken(link),
    );
    expect(rendered?.html).not.toContain("121");
  });

  it("refuses to send to the advisor without an advisor email", async () => {
    const tenant = await createTenant(auth, database, "essential");
    const response = await requestExport(tenant, {
      kind: "period_excel",
      period: "previous_quarter",
      send_to_advisor: true,
    });
    expect(response.status).toBe(400);
  });
});
