import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documentLines,
  documentSeries,
  documents,
  users,
} from "@/db/schema";
import { toApiError } from "@/lib/api/errors";
import {
  convertProformaAndIssue,
  convertProformaToDraft,
} from "@/services/document-conversion";
import { pdfRenderMessageSchema } from "@/workers/messages";
import { createIntegrationDatabase } from "./database";
import { convertedTargetIds, createOwner, type OwnerFixture } from "./fixtures";

async function seedIssuedProforma(owner: OwnerFixture): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(documents).values({
    id,
    companyId: owner.companyId,
    documentType: "proforma",
    status: "issued",
    number: 1,
    fullNumber: "PRO-0001",
    clientId: owner.clientId,
    issueDate: "2026-08-15",
    subtotalCents: 10_000,
    totalCents: 12_100,
    pdfStatus: "ready",
  });
  await database.insert(documentLines).values({
    id: crypto.randomUUID(),
    documentId: id,
    position: 1,
    description: "Servicio",
    quantity: "1.000",
    unitPriceCents: 10_000,
    taxRate: "21.00",
  });
  return id;
}

const database = createIntegrationDatabase();
const queuedMessages: unknown[] = [];
const pdfQueue = {
  send(message: unknown) {
    queuedMessages.push(message);
    return Promise.resolve();
  },
};

function invoiceFullNumber(number: number): string {
  return `2026-${number.toString().padStart(4, "0")}`;
}

describe("concurrent proforma conversion", () => {
  it("without a key, one conversion wins and repeats ask for confirmation", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const proformaId = await seedIssuedProforma(owner);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        convertProformaToDraft({
          database,
          companyId: owner.companyId,
          documentId: proformaId,
          actor: owner.userId,
        }),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(toApiError(result.reason).code).toMatch(
          /conversion_repeat_confirmation_required|conflict/,
        );
      }
    }
    expect(await convertedTargetIds(database, proformaId)).toHaveLength(1);

    const repeat = await convertProformaToDraft({
      database,
      companyId: owner.companyId,
      documentId: proformaId,
      actor: owner.userId,
      confirmRepeat: true,
    });
    expect(await convertedTargetIds(database, proformaId)).toEqual(
      expect.arrayContaining([repeat.id]),
    );
    expect(await convertedTargetIds(database, proformaId)).toHaveLength(2);
  });

  it("links the proforma to a single invoice and consumes exactly the final monthly slot", async () => {
    const now = new Date("2026-08-15T10:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const invoiceSeriesId = crypto.randomUUID();
    const proformaSeriesId = crypto.randomUUID();
    const proformaId = crypto.randomUUID();
    // Quotas are per document type (FR-008): 4 issued invoices leave exactly
    // 1 invoice slot of the Basic plan's 5 for the concurrent conversions to
    // race for; the issued proforma counts only towards the proforma quota.
    const existingIssuedCount = 4;
    const concurrentAttemptCount = 8;

    queuedMessages.length = 0;

    await database.insert(users).values({
      id: userId,
      name: "Conversion Owner",
      email: "proforma-conversion@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Conversión Concurrente, S.L.",
      taxId: "B11223344",
      address: "Calle de la Conversión 1, Madrid",
      email: "billing-conversion@example.test",
      plan: "basic",
      retentionRate: "0.00",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(clients).values({
      id: clientId,
      companyId,
      name: "Cliente Conversión, S.A.",
      taxId: "A99887766",
      address: "Avenida de la Conversión 5, Valencia",
      email: "client-conversion@example.test",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(documentSeries).values([
      {
        id: invoiceSeriesId,
        companyId,
        documentType: "invoice",
        prefix: "2026-",
        nextNumber: existingIssuedCount + 1,
        isDefault: true,
      },
      {
        id: proformaSeriesId,
        companyId,
        documentType: "proforma",
        prefix: "PRO-2026-",
        nextNumber: 2,
        isDefault: true,
      },
    ]);

    const existingInvoices = Array.from(
      { length: existingIssuedCount },
      (_, index) => {
        const number = index + 1;
        return {
          id: crypto.randomUUID(),
          companyId,
          documentType: "invoice" as const,
          status: "issued" as const,
          seriesId: invoiceSeriesId,
          number,
          fullNumber: invoiceFullNumber(number),
          clientId,
          issueDate: "2026-08-01",
          pdfStatus: "ready" as const,
          issuedAt: new Date(`2026-08-0${index + 1}T09:00:00.000Z`),
          createdAt: now,
          updatedAt: now,
        };
      },
    );
    await database.insert(documents).values(existingInvoices);

    await database.insert(documents).values({
      id: proformaId,
      companyId,
      documentType: "proforma",
      status: "issued",
      seriesId: proformaSeriesId,
      number: 1,
      fullNumber: "PRO-2026-0001",
      clientId,
      issueDate: "2026-08-15",
      subtotalCents: 10_000,
      taxBreakdown: [{ rate: "21.00", baseCents: 10_000, taxCents: 2_100 }],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 12_100,
      pdfStatus: "ready",
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(documentLines).values({
      id: crypto.randomUUID(),
      documentId: proformaId,
      position: 1,
      description: "Servicio a convertir",
      quantity: "1.000",
      unitPriceCents: 10_000,
      taxRate: "21.00",
      discountPercentage: "0.00",
    });

    const attemptResults = await Promise.allSettled(
      Array.from({ length: concurrentAttemptCount }, () =>
        // Retries of one request share its Idempotency-Key.
        convertProformaAndIssue(
          {
            companyId,
            documentId: proformaId,
            actor: userId,
            idempotencyKey: "proforma-retry-key-0001",
          },
          { database, queue: pdfQueue, now },
        ),
      ),
    );

    const fulfilled = attemptResults.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof convertProformaAndIssue>>
      > => result.status === "fulfilled",
    );
    const rejected = attemptResults.filter(
      (result) => result.status === "rejected",
    );

    expect(
      rejected.map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([]);
    expect(fulfilled).toHaveLength(concurrentAttemptCount);
    const resolvedInvoiceIds = new Set(
      fulfilled.map((result) => result.value.id),
    );
    expect(resolvedInvoiceIds.size).toBe(1);

    const linkedInvoices = await convertedTargetIds(database, proformaId);
    const invoiceId = linkedInvoices[0];
    expect(invoiceId).toBeTruthy();
    expect(resolvedInvoiceIds.has(invoiceId as string)).toBe(true);
    expect(linkedInvoices).toHaveLength(1);

    const [issuedInvoice] = await database
      .select({
        status: documents.status,
        number: documents.number,
        fullNumber: documents.fullNumber,
        totalCents: documents.totalCents,
      })
      .from(documents)
      .where(eq(documents.id, invoiceId as string));
    expect(issuedInvoice).toMatchObject({
      status: "issued",
      number: existingIssuedCount + 1,
      fullNumber: invoiceFullNumber(existingIssuedCount + 1),
      totalCents: 12_100,
    });

    const [persistedSeries] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, invoiceSeriesId));
    expect(persistedSeries?.nextNumber).toBe(existingIssuedCount + 2);

    const allInvoiceNumbers = await database
      .select({ number: documents.number })
      .from(documents)
      .where(
        inArray(documents.id, [
          ...existingInvoices.map((invoice) => invoice.id),
          invoiceId as string,
        ]),
      )
      .orderBy(asc(documents.number));
    expect(allInvoiceNumbers.map((row) => row.number)).toEqual(
      Array.from({ length: existingIssuedCount + 1 }, (_, index) => index + 1),
    );

    const createdEvents = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, invoiceId as string));
    expect(createdEvents.filter((row) => row.event === "created")).toHaveLength(
      1,
    );
    expect(createdEvents.filter((row) => row.event === "issued")).toHaveLength(
      1,
    );

    const convertedEvents = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, proformaId));
    expect(
      convertedEvents.filter((row) => row.event === "converted"),
    ).toHaveLength(1);

    const parsedQueueMessages = queuedMessages.map((message) =>
      pdfRenderMessageSchema.parse(message),
    );
    expect(parsedQueueMessages).toHaveLength(1);
    expect(parsedQueueMessages[0]?.documentId).toBe(invoiceId);
  });
});
