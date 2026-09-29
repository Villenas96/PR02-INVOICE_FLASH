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
import { convertProformaAndIssue } from "@/services/document-conversion";
import { pdfRenderMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";

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
  it("links the proforma to a single invoice and consumes exactly the final monthly slot", async () => {
    const now = new Date("2026-08-15T10:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const invoiceSeriesId = crypto.randomUUID();
    const proformaSeriesId = crypto.randomUUID();
    const proformaId = crypto.randomUUID();
    // The free plan's monthly quota (5) is shared across every document
    // type, so the already-issued proforma itself takes one of the five
    // slots: 3 invoices + 1 proforma leaves exactly 1 remaining slot for the
    // concurrent conversions to race for.
    const existingIssuedCount = 3;
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
      plan: "free",
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
        convertProformaAndIssue(
          { companyId, documentId: proformaId, actor: userId },
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

    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(concurrentAttemptCount);
    const resolvedInvoiceIds = new Set(
      fulfilled.map((result) => result.value.id),
    );
    expect(resolvedInvoiceIds.size).toBe(1);

    const [linkedProforma] = await database
      .select({ convertedToId: documents.convertedToId })
      .from(documents)
      .where(eq(documents.id, proformaId));
    const invoiceId = linkedProforma?.convertedToId;
    expect(invoiceId).toBeTruthy();
    expect(resolvedInvoiceIds.has(invoiceId as string)).toBe(true);

    const linkedInvoices = await database
      .select({ id: documents.id, convertedFromId: documents.convertedFromId })
      .from(documents)
      .where(eq(documents.convertedFromId, proformaId));
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
