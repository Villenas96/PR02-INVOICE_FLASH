import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  documentEvents,
  documentLinks,
  documentSeries,
  documents,
} from "@/db/schema";
import { ApiError, toApiError } from "@/lib/api/errors";
import { issueDocument } from "@/services/document-issuance";
import { pdfRenderMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";
import {
  createDraft,
  createOwner,
  createSeries,
  FIXTURE_NOW,
  recordingQueue,
  seedIssuedDocuments,
} from "./fixtures";

const database = createIntegrationDatabase();

describe("per-document-type quota in the issuance guard", () => {
  it("rejects invoices at the edge of the quota while proformas still issue", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const invoiceSeries = await createSeries(
      database,
      owner.companyId,
      "invoice",
      {
        nextNumber: 4,
      },
    );
    const proformaSeries = await createSeries(
      database,
      owner.companyId,
      "proforma",
    );
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: invoiceSeries,
      count: 3,
    });
    const invoiceDrafts = await Promise.all(
      Array.from({ length: 5 }, () => createDraft(database, owner)),
    );
    const proformaDrafts = await Promise.all(
      Array.from({ length: 2 }, () =>
        createDraft(database, owner, { documentType: "proforma" }),
      ),
    );
    const queue = recordingQueue();

    const results = await Promise.allSettled(
      [...invoiceDrafts, ...proformaDrafts].map((documentId) =>
        issueDocument(
          { companyId: owner.companyId, documentId, actor: owner.userId },
          { database, queue, now: FIXTURE_NOW },
        ),
      ),
    );

    const invoiceResults = results.slice(0, 5);
    const proformaResults = results.slice(5);
    expect(
      invoiceResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      proformaResults.every((result) => result.status === "fulfilled"),
    ).toBe(true);

    const rejections = invoiceResults.flatMap((result) =>
      result.status === "rejected" ? [toApiError(result.reason)] : [],
    );
    expect(rejections).toHaveLength(3);
    for (const rejection of rejections) {
      expect(rejection).toBeInstanceOf(ApiError);
      expect(rejection).toMatchObject({
        code: "plan_limit_reached",
        status: 402,
        details: {
          document_type: "invoice",
          limit: 5,
          used: 5,
          upgrade_url: "/billing",
        },
      });
    }

    const rejectedIds = invoiceDrafts.filter(
      (_, index) => invoiceResults[index]?.status === "rejected",
    );
    const rejected = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(inArray(documents.id, rejectedIds));
    expect(rejected).toEqual(
      rejectedIds.map(() => ({ status: "draft", number: null })),
    );
    const rejectedEvents = await database
      .select()
      .from(documentEvents)
      .where(inArray(documentEvents.documentId, rejectedIds));
    expect(rejectedEvents).toHaveLength(0);

    const [series] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, invoiceSeries));
    expect(series?.nextNumber).toBe(6);
    const [proformas] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, proformaSeries));
    expect(proformas?.nextNumber).toBe(3);

    const pdfDocumentIds = queue.messages.map(
      (message) => pdfRenderMessageSchema.parse(message).documentId,
    );
    expect(pdfDocumentIds).toHaveLength(4);
    expect(pdfDocumentIds).not.toEqual(expect.arrayContaining(rejectedIds));
  });

  it("does not count issued documents of another month or another type", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const invoiceSeries = await createSeries(
      database,
      owner.companyId,
      "invoice",
      {
        nextNumber: 11,
      },
    );
    const proformaSeries = await createSeries(
      database,
      owner.companyId,
      "proforma",
      { nextNumber: 6 },
    );
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: invoiceSeries,
      count: 5,
      issuedAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await seedIssuedDocuments(database, owner, {
      documentType: "proforma",
      seriesId: proformaSeries,
      count: 5,
    });
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: invoiceSeries,
      count: 4,
      startNumber: 6,
      status: "voided",
    });

    const draft = await createDraft(database, owner);
    const issued = await issueDocument(
      { companyId: owner.companyId, documentId: draft, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    );
    expect(issued.number).toBe(11);

    const blocked = await createDraft(database, owner);
    const error = await issueDocument(
      { companyId: owner.companyId, documentId: blocked, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    ).catch((caught: unknown) => caught);
    expect(toApiError(error)).toMatchObject({
      code: "plan_limit_reached",
      details: { document_type: "invoice", used: 5, limit: 5 },
    });
  });

  it("resolves idempotent repeats before the quota check", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const invoiceSeries = await createSeries(
      database,
      owner.companyId,
      "invoice",
      {
        nextNumber: 6,
      },
    );
    const proformaSeries = await createSeries(
      database,
      owner.companyId,
      "proforma",
      { nextNumber: 2 },
    );
    await seedIssuedDocuments(database, owner, {
      documentType: "proforma",
      seriesId: proformaSeries,
      count: 1,
    });
    const [source] = await database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, owner.companyId),
          eq(documents.documentType, "proforma"),
        ),
      );
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: invoiceSeries,
      count: 5,
    });
    const [existingInvoice] = await database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, owner.companyId),
          eq(documents.documentType, "invoice"),
        ),
      )
      .limit(1);
    if (!source || !existingInvoice) {
      throw new Error("fixture incomplete");
    }
    await database.insert(documentLinks).values({
      id: crypto.randomUUID(),
      companyId: owner.companyId,
      sourceDocumentId: source.id,
      targetDocumentId: existingInvoice.id,
      kind: "converted",
    });

    const repeatDraft = await createDraft(database, owner);
    const queue = recordingQueue();
    const result = await issueDocument(
      {
        companyId: owner.companyId,
        documentId: repeatDraft,
        actor: owner.userId,
        idempotency: { kind: "converted_from", sourceDocumentId: source.id },
      },
      { database, queue, now: FIXTURE_NOW },
    );

    expect(result.id).toBe(existingInvoice.id);
    expect(queue.messages).toHaveLength(0);
  });
});
