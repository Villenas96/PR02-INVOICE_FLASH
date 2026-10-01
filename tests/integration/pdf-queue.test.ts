import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { renderDocumentPdf } from "@/services/pdf/render";
import {
  type PrivateBucket,
  pdfObjectKey,
  type R2ObjectBody,
} from "@/services/storage";
import { createPdfRenderHandler } from "@/workers/handlers/pdf-render";
import { createPdfRenderMessage } from "@/workers/messages";
import {
  processQueueBatch,
  type QueueConsumers,
  type QueueDelivery,
} from "@/workers/queue-consumer";

import { createIntegrationDatabase } from "./database";

interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
}

class InMemoryPrivateBucket implements PrivateBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly putCalls: string[] = [];

  async get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }

    const bytes = new Uint8Array(object.bytes.byteLength);
    bytes.set(object.bytes);
    return {
      body: new Blob([bytes.buffer]).stream(),
      httpMetadata: { contentType: object.contentType },
    };
  }

  async put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    this.putCalls.push(key);
    this.objects.set(key, {
      bytes: value.slice(),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

interface QueueDeliveryFixture {
  delivery: QueueDelivery;
  ackCount: () => number;
  retryCount: () => number;
}

function createQueueDelivery(
  body: unknown,
  attempts = 0,
): QueueDeliveryFixture {
  let acknowledgements = 0;
  let retries = 0;

  return {
    delivery: {
      body,
      attempts,
      ack() {
        acknowledgements += 1;
      },
      retry() {
        retries += 1;
      },
    },
    ackCount: () => acknowledgements,
    retryCount: () => retries,
  };
}

const database = createIntegrationDatabase();
const renderedBytes = new TextEncoder().encode(
  "%PDF-1.7\n% deterministic integration fixture\n%%EOF",
);

async function seedPendingDocument(): Promise<{
  companyId: string;
  documentId: string;
}> {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const now = new Date("2026-07-30T12:00:00.000Z");

  await database.insert(users).values({
    id: userId,
    name: "PDF Queue User",
    email: `pdf-${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Estudio PDF, S.L.",
    taxId: "B12345678",
    address: "Calle de la Prueba, 1, Madrid",
    email: "pdf@example.test",
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente PDF, S.L.",
    taxId: "B87654321",
    address: "Avenida de la Cola, 2, Valencia",
  });
  await database.insert(documentSeries).values({
    id: seriesId,
    companyId,
    documentType: "invoice",
    prefix: "2026-",
    nextNumber: 2,
    isDefault: true,
  });
  await database.insert(documents).values({
    id: documentId,
    companyId,
    documentType: "invoice",
    status: "issued",
    seriesId,
    number: 1,
    fullNumber: "2026-0001",
    clientId,
    issueDate: "2026-07-30",
    dueDate: "2026-08-29",
    subtotalCents: 10_000,
    taxBreakdown: [{ rate: "21.00", baseCents: 10_000, taxCents: 2_100 }],
    retentionRate: "0",
    retentionCents: 0,
    totalCents: 12_100,
    issuerSnapshot: {
      legalName: "Estudio PDF, S.L.",
      taxId: "B12345678",
      address: "Calle de la Prueba, 1, Madrid",
    },
    clientSnapshot: {
      legalName: "Cliente PDF, S.L.",
      taxId: "B87654321",
      address: "Avenida de la Cola, 2, Valencia",
    },
    pdfStatus: "pending",
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(documentLines).values({
    id: crypto.randomUUID(),
    documentId,
    position: 1,
    description: "Servicio de prueba",
    quantity: "1.000",
    unitPriceCents: 10_000,
    taxRate: "21.00",
    lineSubtotalCents: 10_000,
    lineTaxCents: 2_100,
    lineTotalCents: 12_100,
  });

  return { companyId, documentId };
}

describe("pdf queue re-delivery", () => {
  let bucket: InMemoryPrivateBucket;

  beforeEach(() => {
    bucket = new InMemoryPrivateBucket();
  });

  it("creates one deterministic object and one event for concurrent and later duplicates", async () => {
    const { companyId, documentId } = await seedPendingDocument();
    const message = createPdfRenderMessage(documentId);
    const firstDelivery = createQueueDelivery(message);
    const concurrentDuplicate = createQueueDelivery(message);
    let releaseRender: (() => void) | undefined;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    let renderCalls = 0;

    const renderPdf = async () => {
      renderCalls += 1;
      await renderGate;
      return renderedBytes;
    };
    const renderPdfMessage = createPdfRenderHandler({
      database,
      bucket,
      renderPdf,
    });
    const consumers: QueueConsumers = {
      renderPdf: renderPdfMessage,
      sendEmail: () =>
        Promise.reject(
          new Error("El consumidor de email no debe recibir mensajes PDF."),
        ),
    };

    const concurrentBatch = processQueueBatch(
      {
        messages: [firstDelivery.delivery, concurrentDuplicate.delivery],
      },
      consumers,
    );

    await vi.waitFor(() => {
      expect(renderCalls).toBeGreaterThan(0);
    });
    releaseRender?.();
    await concurrentBatch;

    const deterministicKey = pdfObjectKey(documentId);
    expect(renderCalls).toBe(1);
    expect(bucket.putCalls).toEqual([deterministicKey]);
    expect([...bucket.objects.keys()]).toEqual([deterministicKey]);
    expect(bucket.objects.get(deterministicKey)).toEqual({
      bytes: renderedBytes,
      contentType: "application/pdf",
    });
    expect(firstDelivery.ackCount()).toBe(1);
    expect(concurrentDuplicate.ackCount()).toBe(1);
    expect(firstDelivery.retryCount()).toBe(0);
    expect(concurrentDuplicate.retryCount()).toBe(0);

    const [storedDocument] = await database
      .select({
        pdfStatus: documents.pdfStatus,
        pdfReadyAt: documents.pdfReadyAt,
      })
      .from(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.companyId, companyId)),
      );
    expect(storedDocument?.pdfStatus).toBe("ready");
    expect(storedDocument?.pdfReadyAt).toBeInstanceOf(Date);

    const generatedEvents = await database
      .select({
        actor: documentEvents.actor,
        event: documentEvents.event,
      })
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.documentId, documentId),
          eq(documentEvents.event, "pdf_generated"),
        ),
      );
    expect(generatedEvents).toEqual([
      {
        actor: "system",
        event: "pdf_generated",
      },
    ]);

    const laterDuplicate = createQueueDelivery(message, 1);
    await processQueueBatch({ messages: [laterDuplicate.delivery] }, consumers);

    expect(renderCalls).toBe(1);
    expect(bucket.putCalls).toEqual([deterministicKey]);
    expect(laterDuplicate.ackCount()).toBe(1);
    expect(laterDuplicate.retryCount()).toBe(0);
    await expect(
      database
        .select({ id: documentEvents.id })
        .from(documentEvents)
        .where(
          and(
            eq(documentEvents.documentId, documentId),
            eq(documentEvents.event, "pdf_generated"),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("marks a document whose snapshot can never render as failed, without retrying", async () => {
    const { documentId } = await seedPendingDocument();
    // An invoice issued before client fiscal data was required at issue.
    await database
      .update(documents)
      .set({
        clientSnapshot: { legalName: "Cliente PDF, S.L.", taxId: "B87654321" },
      })
      .where(eq(documents.id, documentId));
    const delivery = createQueueDelivery(createPdfRenderMessage(documentId));
    let renderCalls = 0;
    const consumers: QueueConsumers = {
      renderPdf: createPdfRenderHandler({
        database,
        bucket,
        renderPdf: () => {
          renderCalls += 1;
          return Promise.resolve(renderedBytes);
        },
      }),
      sendEmail: () => Promise.resolve(),
    };

    await processQueueBatch({ messages: [delivery.delivery] }, consumers);

    expect(renderCalls).toBe(0);
    expect(delivery.ackCount()).toBe(1);
    expect(delivery.retryCount()).toBe(0);
    expect(bucket.putCalls).toHaveLength(0);
    await expect(
      database
        .select({ pdfStatus: documents.pdfStatus })
        .from(documents)
        .where(eq(documents.id, documentId)),
    ).resolves.toEqual([{ pdfStatus: "failed" }]);
    await expect(
      database
        .select({ event: documentEvents.event })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, documentId)),
    ).resolves.toEqual([{ event: "pdf_failed" }]);
  });

  it("renders a proforma whose client has no tax id or address", async () => {
    const { documentId } = await seedPendingDocument();
    await database
      .update(documents)
      .set({
        documentType: "proforma",
        clientSnapshot: { legalName: "Cliente sin datos fiscales" },
      })
      .where(eq(documents.id, documentId));
    const delivery = createQueueDelivery(createPdfRenderMessage(documentId));

    await processQueueBatch(
      { messages: [delivery.delivery] },
      {
        renderPdf: createPdfRenderHandler({ database, bucket }),
        sendEmail: () => Promise.resolve(),
      },
    );

    expect(delivery.ackCount()).toBe(1);
    expect(bucket.putCalls).toHaveLength(1);
    await expect(
      database
        .select({ pdfStatus: documents.pdfStatus })
        .from(documents)
        .where(eq(documents.id, documentId)),
    ).resolves.toEqual([{ pdfStatus: "ready" }]);
  });

  it("persists one failed terminal state and does not rerender a later duplicate", async () => {
    const { documentId } = await seedPendingDocument();
    const message = createPdfRenderMessage(documentId);
    const firstDelivery = createQueueDelivery(message);
    let renderCalls = 0;
    const renderPdfMessage = createPdfRenderHandler({
      database,
      bucket,
      renderPdf: () => {
        renderCalls += 1;
        return Promise.reject(new Error("Fallo de render controlado."));
      },
    });
    const consumers: QueueConsumers = {
      renderPdf: renderPdfMessage,
      sendEmail: () => Promise.resolve(),
    };

    await processQueueBatch({ messages: [firstDelivery.delivery] }, consumers);

    expect(renderCalls).toBe(1);
    expect(firstDelivery.ackCount()).toBe(0);
    expect(firstDelivery.retryCount()).toBe(1);
    expect(bucket.putCalls).toHaveLength(0);
    await expect(
      database
        .select({ pdfStatus: documents.pdfStatus })
        .from(documents)
        .where(eq(documents.id, documentId)),
    ).resolves.toEqual([{ pdfStatus: "failed" }]);
    await expect(
      database
        .select({ event: documentEvents.event })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, documentId)),
    ).resolves.toEqual([{ event: "pdf_failed" }]);

    const laterDuplicate = createQueueDelivery(message, 1);
    await processQueueBatch({ messages: [laterDuplicate.delivery] }, consumers);

    expect(renderCalls).toBe(1);
    expect(laterDuplicate.ackCount()).toBe(1);
    expect(laterDuplicate.retryCount()).toBe(0);
    await expect(
      database
        .select({ event: documentEvents.event })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, documentId)),
    ).resolves.toEqual([{ event: "pdf_failed" }]);
  });
});

describe("receipt pdf rendering", () => {
  it("renders a real single-page receipt PDF referencing the source invoice and payment", async () => {
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const now = new Date("2026-09-20T12:00:00.000Z");

    await database.insert(users).values({
      id: userId,
      name: "Receipt PDF User",
      email: `receipt-pdf-${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Estudio Recibos, S.L.",
      taxId: "B12345678",
      address: "Calle del Recibo, 1, Madrid",
      email: "receipts@example.test",
    });
    await database.insert(clients).values({
      id: clientId,
      companyId,
      name: "Cliente Recibo, S.L.",
      taxId: "B87654321",
      address: "Avenida del Cobro, 2, Valencia",
    });
    await database.insert(documents).values({
      id: invoiceId,
      companyId,
      documentType: "invoice",
      status: "issued",
      number: 1,
      fullNumber: "2026-0001",
      clientId,
      issueDate: "2026-09-01",
      totalCents: 5_000,
      pdfStatus: "ready",
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(payments).values({
      id: paymentId,
      companyId,
      documentId: invoiceId,
      amountCents: 5_000,
      paidOn: "2026-09-20",
    });
    await database.insert(documents).values({
      id: receiptId,
      companyId,
      documentType: "receipt",
      status: "issued",
      number: 1,
      fullNumber: "REC-2026-0001",
      clientId,
      invoiceId,
      paymentId,
      issueDate: "2026-09-20",
      subtotalCents: 0,
      taxBreakdown: [],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 5_000,
      issuerSnapshot: {
        legalName: "Estudio Recibos, S.L.",
        taxId: "B12345678",
        address: "Calle del Recibo, 1, Madrid",
      },
      clientSnapshot: {
        legalName: "Cliente Recibo, S.L.",
        taxId: "B87654321",
        address: "Avenida del Cobro, 2, Valencia",
      },
      pdfStatus: "pending",
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const bucket = new InMemoryPrivateBucket();
    const renderPdfMessage = createPdfRenderHandler({
      database,
      bucket,
      renderPdf: renderDocumentPdf,
    });
    const consumers: QueueConsumers = {
      renderPdf: renderPdfMessage,
      sendEmail: () =>
        Promise.reject(
          new Error("El consumidor de email no debe recibir mensajes PDF."),
        ),
    };
    const delivery = createQueueDelivery(createPdfRenderMessage(receiptId));

    await processQueueBatch({ messages: [delivery.delivery] }, consumers);

    expect(delivery.ackCount()).toBe(1);
    expect(delivery.retryCount()).toBe(0);

    const [storedReceipt] = await database
      .select({ pdfStatus: documents.pdfStatus })
      .from(documents)
      .where(eq(documents.id, receiptId));
    expect(storedReceipt?.pdfStatus).toBe("ready");

    const stored = await bucket.get(pdfObjectKey(receiptId));
    expect(stored).not.toBeNull();
    const bytes = new Uint8Array(
      await new Response(stored?.body).arrayBuffer(),
    );
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Recibo REC-2026-0001");
  });
});
