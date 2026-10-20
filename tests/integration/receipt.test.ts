import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documentLines,
  documentSeries,
  documents,
  payments,
  users,
} from "@/db/schema";
import { toApiError } from "@/lib/api/errors";
import { convertProformaAndIssue } from "@/services/document-conversion";
import { issueDocument } from "@/services/document-issuance";
import { createReceiptFromPayment } from "@/services/document-receipts";
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

describe("concurrent mixed-route document issue with per-type quotas", () => {
  it("lets one invoice route claim the final invoice slot while the receipt uses its own quota", async () => {
    const now = new Date("2026-09-20T10:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const invoiceSeriesId = crypto.randomUUID();
    const proformaSeriesId = crypto.randomUUID();
    const receiptSeriesId = crypto.randomUUID();
    // Quotas are per document type (FR-008). The Basic plan allows 5 of
    // each: 4 issued invoices leave exactly 1 invoice slot for the two
    // invoice-producing routes (conventional issue and proforma conversion)
    // to race for, while 4 issued receipts leave the new receipt its own
    // final receipt slot, unaffected by the invoice race.
    const existingIssuedCount = 4;
    const existingReceiptCount = 4;

    queuedMessages.length = 0;

    await database.insert(users).values({
      id: userId,
      name: "Receipt Owner",
      email: "mixed-route-receipt@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Ruta Mixta, S.L.",
      taxId: "B55667788",
      address: "Calle de la Ruta Mixta 1, Madrid",
      email: "billing-mixed-route@example.test",
      plan: "basic",
      retentionRate: "0.00",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(clients).values({
      id: clientId,
      companyId,
      name: "Cliente Ruta Mixta, S.A.",
      taxId: "A11224433",
      address: "Avenida de la Ruta Mixta 5, Valencia",
      email: "client-mixed-route@example.test",
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
        nextNumber: 1,
        isDefault: true,
      },
      {
        id: receiptSeriesId,
        companyId,
        documentType: "receipt",
        prefix: "REC-2026-",
        nextNumber: existingReceiptCount + 1,
        isDefault: true,
      },
    ]);

    // The payment source invoice is the first of the pre-issued invoices.
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
          issueDate: "2026-09-01",
          totalCents: 5_000,
          pdfStatus: "ready" as const,
          issuedAt: new Date(`2026-09-0${index + 1}T09:00:00.000Z`),
          createdAt: now,
          updatedAt: now,
        };
      },
    );
    await database.insert(documents).values(existingInvoices);
    await database.insert(documents).values(
      Array.from({ length: existingReceiptCount }, (_, index) => ({
        id: crypto.randomUUID(),
        companyId,
        documentType: "receipt" as const,
        status: "issued" as const,
        seriesId: receiptSeriesId,
        number: index + 1,
        fullNumber: `REC-2026-${(index + 1).toString().padStart(4, "0")}`,
        clientId,
        issueDate: "2026-09-01",
        totalCents: 1_000,
        pdfStatus: "ready" as const,
        issuedAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`),
        createdAt: now,
        updatedAt: now,
      })),
    );
    const paymentSourceInvoiceId = existingInvoices[0]?.id;
    if (!paymentSourceInvoiceId) {
      throw new Error("No se ha sembrado la factura de origen del pago.");
    }

    const paymentId = crypto.randomUUID();
    await database.insert(payments).values({
      id: paymentId,
      companyId,
      documentId: paymentSourceInvoiceId,
      amountCents: 5_000,
      paidOn: "2026-09-20",
    });

    // Candidate A: conventional draft invoice issuance.
    const conventionalDraftId = crypto.randomUUID();
    await database.insert(documents).values({
      id: conventionalDraftId,
      companyId,
      documentType: "invoice",
      status: "draft",
      clientId,
      issueDate: "2026-09-20",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(documentLines).values({
      id: crypto.randomUUID(),
      documentId: conventionalDraftId,
      position: 1,
      description: "Servicio convencional",
      quantity: "1.000",
      unitPriceCents: 8_000,
      taxRate: "21.00",
      discountPercentage: "0.00",
    });

    // Candidate B: issued, unconverted proforma competing via direct
    // conversion-and-issue.
    const proformaId = crypto.randomUUID();
    await database.insert(documents).values({
      id: proformaId,
      companyId,
      documentType: "proforma",
      status: "issued",
      seriesId: proformaSeriesId,
      number: 1,
      fullNumber: "PRO-2026-0001",
      clientId,
      issueDate: "2026-09-20",
      subtotalCents: 6_000,
      taxBreakdown: [{ rate: "21.00", baseCents: 6_000, taxCents: 1_260 }],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 7_260,
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
      unitPriceCents: 6_000,
      taxRate: "21.00",
      discountPercentage: "0.00",
    });

    // Candidate C: a brand-new receipt for the seeded payment.
    const candidates = {
      conventional: () =>
        issueDocument(
          { companyId, documentId: conventionalDraftId, actor: userId },
          { database, queue: pdfQueue, now },
        ),
      conversion: () =>
        convertProformaAndIssue(
          { companyId, documentId: proformaId, actor: userId },
          { database, queue: pdfQueue, now },
        ),
      receipt: () =>
        createReceiptFromPayment(
          {
            companyId,
            invoiceId: paymentSourceInvoiceId,
            paymentId,
            actor: userId,
          },
          { database, queue: pdfQueue, now },
        ),
    } as const;

    const candidateNames = Object.keys(candidates) as Array<
      keyof typeof candidates
    >;
    const settled = await Promise.allSettled(
      candidateNames.map((name) => candidates[name]()),
    );

    const fulfilled = settled.flatMap((result, index) =>
      result.status === "fulfilled"
        ? [{ name: candidateNames[index], id: result.value.id }]
        : [],
    );
    const rejected = settled.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ name: candidateNames[index], reason: result.reason }]
        : [],
    );

    // The receipt always wins its own slot; exactly one invoice route wins.
    expect(fulfilled.map(({ name }) => name)).toContain("receipt");
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    for (const { reason } of rejected) {
      expect(toApiError(reason)).toMatchObject({
        code: "plan_limit_reached",
        status: 402,
        details: { document_type: "invoice", limit: 5, used: 5 },
      });
    }

    const winner = fulfilled.find(({ name }) => name !== "receipt");
    const receiptWinner = fulfilled.find(({ name }) => name === "receipt");
    if (!winner || !receiptWinner) {
      throw new Error("Ningún candidato ha ganado la ranura de facturas.");
    }

    const persistedSeries = await database
      .select({
        documentType: documentSeries.documentType,
        nextNumber: documentSeries.nextNumber,
      })
      .from(documentSeries)
      .where(eq(documentSeries.companyId, companyId));
    const seriesByType = new Map(
      persistedSeries.map((row) => [row.documentType, row.nextNumber]),
    );
    // Each series advanced exactly once: one invoice and one receipt.
    expect(seriesByType.get("invoice")).toBe(existingIssuedCount + 2);
    expect(seriesByType.get("receipt")).toBe(existingReceiptCount + 2);

    const conventionalRow = (
      await database
        .select({ status: documents.status, number: documents.number })
        .from(documents)
        .where(eq(documents.id, conventionalDraftId))
    )[0];
    const proformaRow = (
      await database
        .select({
          status: documents.status,
          convertedToId: documents.convertedToId,
        })
        .from(documents)
        .where(eq(documents.id, proformaId))
    )[0];
    const receiptRows = await database
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(eq(documents.paymentId, paymentId));

    expect(receiptRows).toHaveLength(1);
    const receiptRow = receiptRows[0];
    if (!receiptRow) {
      throw new Error("No se ha creado el borrador del recibo.");
    }

    // Draft-mode conversion never touches plan quota, so the conversion
    // candidate always links the proforma to a new invoice draft regardless
    // of whether it goes on to win the shared issuance slot.
    expect(proformaRow?.convertedToId).toBeTruthy();
    const linkedDraft = (
      await database
        .select({ status: documents.status, number: documents.number })
        .from(documents)
        .where(eq(documents.id, proformaRow?.convertedToId as string))
    )[0];

    expect(receiptRow.status).toBe("issued");
    expect(receiptRow.id).toBe(receiptWinner.id);
    if (winner.name === "conventional") {
      expect(conventionalRow).toMatchObject({ status: "issued" });
      expect(linkedDraft).toMatchObject({ status: "draft", number: null });
    } else {
      expect(conventionalRow).toMatchObject({ status: "draft", number: null });
      expect(linkedDraft).toMatchObject({ status: "issued" });
      expect(linkedDraft?.number).not.toBeNull();
    }

    const messagesAfterRace = queuedMessages.length;
    expect(messagesAfterRace).toBe(2);

    // Replaying the receipt request must never duplicate side effects: it
    // resolves to the same issued receipt without consuming another slot.
    const replayed = await candidates.receipt();
    expect(replayed.id).toBe(receiptWinner.id);

    const receiptRowsAfterReplay = await database
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.paymentId, paymentId));
    expect(receiptRowsAfterReplay).toHaveLength(1);

    const receiptEventsAfterReplay = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.documentId, receiptRow.id));
    expect(receiptEventsAfterReplay.length).toBeLessThanOrEqual(2);

    expect(queuedMessages.length).toBe(messagesAfterRace);

    const [seriesAfterReplay] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, receiptSeriesId));
    expect(seriesAfterReplay?.nextNumber).toBe(existingReceiptCount + 2);

    const parsedQueueMessages = queuedMessages.map((message) =>
      pdfRenderMessageSchema.parse(message),
    );
    expect(
      parsedQueueMessages.map(({ documentId }) => documentId).sort(),
    ).toEqual([winner.id, receiptWinner.id].sort());
  });
});
