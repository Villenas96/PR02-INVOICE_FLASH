import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { companies, documents, exportJobs, users } from "@/db/schema";
import { buildExport } from "@/services/exports";

import { InMemoryBucket } from "../integration/bucket";
import {
  createIntegrationDatabase,
  truncateIntegrationDatabase,
} from "../integration/database";
import { recordingQueue } from "../integration/fixtures";
import { expectP95Below } from "./report";

const database = createIntegrationDatabase();
const DOCUMENT_COUNT = 500;
const READY_WITHIN_MS = 60_000;
const PDF_BYTES = 40 * 1024;
const INSERT_BATCH_SIZE = 250;

describe("export performance (SC-006)", () => {
  it(`exports ${DOCUMENT_COUNT} documents as XLSX + ZIP in under ${READY_WITHIN_MS / 1000}s`, async () => {
    await truncateIntegrationDatabase();
    const now = new Date("2026-10-20T08:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    await database.insert(users).values({
      id: userId,
      name: "Rendimiento",
      email: `perf-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Empresa Rendimiento, S.L.",
      email: "perf@example.test",
      plan: "pro",
    });

    const bucket = new InMemoryBucket();
    const pdf = new Uint8Array(PDF_BYTES).fill(37);
    const rows = Array.from({ length: DOCUMENT_COUNT }, (_, index) => ({
      id: crypto.randomUUID(),
      companyId,
      documentType: "invoice" as const,
      status: "issued" as const,
      number: index + 1,
      fullNumber: `2026-${String(index + 1).padStart(4, "0")}`,
      issueDate: `2026-${String((index % 3) + 7).padStart(2, "0")}-15`,
      subtotalCents: 10_000,
      taxBreakdown: [
        { name: "IVA", rate: "21.00", baseCents: 10_000, taxCents: 2_100 },
      ],
      totalCents: 12_100,
      clientSnapshot: { name: `Cliente ${index}`, taxId: "B12345678" },
      pdfStatus: "ready" as const,
    }));
    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
      await database
        .insert(documents)
        .values(rows.slice(offset, offset + INSERT_BATCH_SIZE));
    }
    for (const row of rows) {
      await bucket.put(`documents/${row.id}/pdf/v1.pdf`, pdf);
    }
    const [job] = await database
      .insert(exportJobs)
      .values({
        id: crypto.randomUUID(),
        companyId,
        requestedBy: `user:${userId}`,
        kind: "advanced",
        filters: { types: ["invoice"], from: "2026-07-01", to: "2026-09-30" },
        formats: ["xlsx", "pdf_zip"],
      })
      .returning();

    const startedAt = performance.now();
    await buildExport(job?.id as string, {
      database,
      bucket,
      pdfQueue: recordingQueue(),
      emailQueue: recordingQueue(),
      secret: "perf-secret-at-least-thirty-two-characters!!",
      now,
    });
    const elapsed = performance.now() - startedAt;

    const zipKey = [...bucket.objects.keys()].find((key) =>
      key.endsWith(".zip"),
    ) as string;
    const zip = bucket.objects.get(zipKey)?.bytes as Uint8Array;
    expect(Object.keys(unzipSync(zip))).toHaveLength(DOCUMENT_COUNT);
    expectP95Below([elapsed], READY_WITHIN_MS);
  }, 120_000);
});
