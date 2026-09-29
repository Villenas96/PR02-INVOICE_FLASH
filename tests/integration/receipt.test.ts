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

describe("concurrent mixed-route document issue sharing the monthly quota", () => {
  it("lets exactly one of a conventional issue, a proforma conversion and a new receipt claim the final slot", async () => {
    const now = new Date("2026-09-20T10:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const invoiceSeriesId = crypto.randomUUID();
    const proformaSeriesId = crypto.randomUUID();
    const receiptSeriesId = crypto.randomUUID();
    // The free plan's monthly quota (5) is shared across every document
    // type, so the already-issued proforma candidate below also takes one of
    // the five slots: 3 invoices + 1 proforma leaves exactly 1 remaining slot
    // for the three candidates to race for.
    const existingIssuedCount = 3;

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
      plan: "free",
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
        nextNumber: 1,
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

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const { reason } of rejected) {
      expect(toApiError(reason)).toMatchObject({
        code: "plan_limit_reached",
        status: 402,
      });
    }

    const winner = fulfilled[0];
    if (!winner) {
      throw new Error("Ningún candidato ha ganado la ranura mensual.");
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
    // Only the winner's own series advanced; the other two document types
    // never allocated a number.
    expect(seriesByType.get("invoice")).toBe(
      winner.name === "conventional" || winner.name === "conversion"
        ? existingIssuedCount + 2
        : existingIssuedCount + 1,
    );
    expect(seriesByType.get("receipt")).toBe(winner.name === "receipt" ? 2 : 1);

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

    if (winner.name === "conventional") {
      expect(conventionalRow).toMatchObject({ status: "issued" });
      expect(linkedDraft).toMatchObject({ status: "draft", number: null });
      expect(receiptRow.status).toBe("draft");
    } else if (winner.name === "conversion") {
      expect(conventionalRow).toMatchObject({ status: "draft", number: null });
      expect(linkedDraft).toMatchObject({ status: "issued" });
      expect(linkedDraft?.number).not.toBeNull();
      expect(receiptRow.status).toBe("draft");
    } else {
      expect(conventionalRow).toMatchObject({ status: "draft", number: null });
      expect(linkedDraft).toMatchObject({ status: "draft", number: null });
      expect(receiptRow.status).toBe("issued");
      expect(receiptRow.id).toBe(winner.id);
    }

    const messagesAfterRace = queuedMessages.length;
    expect(messagesAfterRace).toBe(1);

    // Replaying the receipt request must never duplicate side effects: if it
    // already won, it resolves to the same issued document without consuming
    // another slot; if it lost, the quota is still exhausted and it fails the
    // same way again, without creating a second draft row.
    const replaySettled = await Promise.allSettled([candidates.receipt()]);
    const replayResult = replaySettled[0];
    if (!replayResult) {
      throw new Error("No se ha repetido la solicitud de recibo.");
    }

    if (winner.name === "receipt") {
      expect(replayResult.status).toBe("fulfilled");
      if (replayResult.status === "fulfilled") {
        expect(replayResult.value.id).toBe(winner.id);
      }
    } else {
      expect(replayResult.status).toBe("rejected");
      if (replayResult.status === "rejected") {
        expect(toApiError(replayResult.reason)).toMatchObject({
          code: "plan_limit_reached",
          status: 402,
        });
      }
    }

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
    expect(seriesAfterReplay?.nextNumber).toBe(
      winner.name === "receipt" ? 2 : 1,
    );

    const parsedQueueMessages = queuedMessages.map((message) =>
      pdfRenderMessageSchema.parse(message),
    );
    expect(parsedQueueMessages).toHaveLength(1);
    expect(parsedQueueMessages[0]?.documentId).toBe(winner.id);
  });
});
