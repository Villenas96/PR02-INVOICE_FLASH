import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { documentSeries, documents, sampleRenders } from "@/db/schema";
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
const { POST: requestSampleRoute } = await import(
  "@/app/api/v1/company/onboarding/sample/route"
);
const { GET: sampleRoute } = await import(
  "@/app/api/v1/company/onboarding/sample/[id]/route"
);
const { PATCH: onboardingRoute, GET: onboardingGet } = await import(
  "@/app/api/v1/company/onboarding/route"
);
const { GET: companyRoute } = await import("@/app/api/v1/company/route");
const { handlePdfSample } = await import("@/workers/handlers/pdf-sample");
const { purgeExpiredSamples, SAMPLE_RETENTION_MS } = await import(
  "@/services/onboarding"
);
const { runScheduledPurge } = await import("@/workers/scheduled");

const NOW = new Date("2026-10-20T08:00:00.000Z");
let bucket: InMemoryBucket;
let jobs: ReturnType<typeof recordingQueue>;
let tenant: Tenant;

beforeEach(async () => {
  bucket = new InMemoryBucket();
  jobs = recordingQueue();
  cloudflareState.env = { STORAGE_BUCKET: bucket, JOBS_QUEUE: jobs };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
  tenant = await createTenant(auth, database, "basic");
});

async function requestSample(): Promise<string> {
  const response = await requestSampleRoute(
    authenticatedRequest(tenant, "/api/v1/company/onboarding/sample", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(202);
  return ((await response.json()) as { sample_id: string }).sample_id;
}

async function readSample(id: string): Promise<Response> {
  return sampleRoute(
    authenticatedRequest(tenant, `/api/v1/company/onboarding/sample/${id}`),
    routeContext({ id }),
  );
}

async function counters() {
  const [docs] = await database
    .select({ total: count() })
    .from(documents)
    .where(eq(documents.companyId, tenant.companyId));
  const series = await database
    .select({ next: documentSeries.nextNumber })
    .from(documentSeries)
    .where(eq(documentSeries.companyId, tenant.companyId));
  return { documents: docs?.total ?? 0, series: series.map((s) => s.next) };
}

describe("sample invoice", () => {
  it("renders a watermarked PDF through the queue without creating a document", async () => {
    const before = await counters();
    const id = await requestSample();

    const message = jobMessageSchema.parse(jobs.messages[0]);
    expect(message).toMatchObject({ type: "pdf.sample", sampleRenderId: id });

    const pending = await readSample(id);
    expect(pending.status).toBe(202);
    expect(pending.headers.get("Retry-After")).toBeTruthy();

    let rendered: { watermark?: string | null } | undefined;
    await handlePdfSample(
      { type: "pdf.sample", sampleRenderId: id, enqueuedAt: NOW.toISOString() },
      {
        database,
        bucket,
        renderPdf: (input) => {
          rendered = input;
          return Promise.resolve(new TextEncoder().encode("%PDF sample"));
        },
      },
    );
    expect(rendered?.watermark).toBe("EJEMPLO – sin validez");
    expect(bucket.objects.has(`samples/${tenant.companyId}/${id}.pdf`)).toBe(
      true,
    );

    const ready = await readSample(id);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("Content-Type")).toBe("application/pdf");

    // No document, no number, no quota, absent from lists, usage and totals.
    expect(await counters()).toEqual(before);
    const list = await (await import("@/app/api/v1/documents/route")).GET(
      authenticatedRequest(tenant, "/api/v1/documents"),
    );
    expect(((await list.json()) as { items: unknown[] }).items).toEqual([]);
    const company = (await (
      await companyRoute(authenticatedRequest(tenant, "/api/v1/company"))
    ).json()) as { usage: Array<{ used: number }> };
    expect(company.usage.every((entry) => entry.used === 0)).toBe(true);
  });

  it("renders a real watermarked PDF with pdf-lib", async () => {
    const id = await requestSample();
    await handlePdfSample(
      { type: "pdf.sample", sampleRenderId: id, enqueuedAt: NOW.toISOString() },
      { database, bucket },
    );
    const stored = bucket.objects.get(`samples/${tenant.companyId}/${id}.pdf`);
    expect(stored).toBeDefined();
    expect(new TextDecoder().decode(stored?.bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("is idempotent when the message is redelivered", async () => {
    const id = await requestSample();
    const message = {
      type: "pdf.sample" as const,
      sampleRenderId: id,
      enqueuedAt: NOW.toISOString(),
    };
    const renderPdf = vi.fn(() =>
      Promise.resolve(new TextEncoder().encode("%PDF sample")),
    );
    await handlePdfSample(message, { database, bucket, renderPdf });
    await handlePdfSample(message, { database, bucket, renderPdf });
    expect(renderPdf).toHaveBeenCalledOnce();
  });

  it("marks a render that cannot be produced as failed (409, not 202 forever)", async () => {
    const id = await requestSample();
    await handlePdfSample(
      { type: "pdf.sample", sampleRenderId: id, enqueuedAt: NOW.toISOString() },
      { database, bucket, renderPdf: () => Promise.reject(new Error("boom")) },
    );
    expect((await readSample(id)).status).toBe(409);
  });

  it("limits how many samples a company can request per hour", async () => {
    for (let index = 0; index < 10; index += 1) {
      await requestSample();
    }
    const response = await requestSampleRoute(
      authenticatedRequest(tenant, "/api/v1/company/onboarding/sample", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(409);
  });

  it("deletes samples after 7 days, object included", async () => {
    const id = await requestSample();
    await handlePdfSample(
      { type: "pdf.sample", sampleRenderId: id, enqueuedAt: NOW.toISOString() },
      {
        database,
        bucket,
        renderPdf: () => Promise.resolve(new TextEncoder().encode("%PDF")),
      },
    );
    const key = `samples/${tenant.companyId}/${id}.pdf`;
    const [row] = await database
      .select({ createdAt: sampleRenders.createdAt })
      .from(sampleRenders)
      .where(eq(sampleRenders.id, id));
    const createdAt = row?.createdAt as Date;

    const early = new Date(createdAt.getTime() + SAMPLE_RETENTION_MS - 1000);
    expect(await purgeExpiredSamples({ database, bucket, now: early })).toBe(0);
    expect(bucket.objects.has(key)).toBe(true);

    const late = new Date(createdAt.getTime() + SAMPLE_RETENTION_MS + 1000);
    await runScheduledPurge({
      database,
      now: late,
      bucket: Object.assign(bucket, {
        list: () => Promise.resolve({ objects: [], truncated: false }),
      }),
    });
    expect(bucket.objects.has(key)).toBe(false);
    expect(
      await database
        .select({ id: sampleRenders.id })
        .from(sampleRenders)
        .where(eq(sampleRenders.id, id)),
    ).toEqual([]);
  });
});

describe("onboarding state", () => {
  it("records complete, skip and dismiss and reports progress in GET /company", async () => {
    const patch = (body: unknown) =>
      onboardingRoute(
        authenticatedRequest(tenant, "/api/v1/company/onboarding", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      );
    const skipped = await patch({ skip: "logo" });
    expect(skipped.status).toBe(200);
    expect(
      (
        (await skipped.json()) as {
          steps: Array<{ step: string; status: string }>;
        }
      ).steps.find((s) => s.step === "logo")?.status,
    ).toBe("skipped");
    expect((await patch({ complete: "series" })).status).toBe(200);
    expect((await patch({ dismiss: true })).status).toBe(200);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ complete: "nope" })).status).toBe(400);

    const read = (await (
      await onboardingGet(
        authenticatedRequest(tenant, "/api/v1/company/onboarding"),
      )
    ).json()) as { currentStep: string; label: string; dismissed: boolean };
    expect(read).toMatchObject({
      currentStep: "collection_method",
      label: "Paso 3 de 5",
      dismissed: true,
    });
    const company = (await (
      await companyRoute(authenticatedRequest(tenant, "/api/v1/company"))
    ).json()) as { onboarding: { currentStep: string } };
    expect(company.onboarding.currentStep).toBe("collection_method");
  });

  it("answers 404 for a sample of another company", async () => {
    const other = await createTenant(auth, database, "basic");
    const [foreign] = await database
      .insert(sampleRenders)
      .values({ id: crypto.randomUUID(), companyId: other.companyId })
      .returning({ id: sampleRenders.id });
    expect((await readSample(foreign?.id as string)).status).toBe(404);
  });
});
