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
import { issueDocument } from "@/services/document-issuance";
import { pdfRenderMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";

type LockResource = "company" | "document_series";

interface IssueAttempt {
  documentId: string;
  lockOrder: LockResource[];
  promise: Promise<unknown>;
}

const database = createIntegrationDatabase();
const queuedMessages: unknown[] = [];
const pdfQueue = {
  send(message: unknown) {
    queuedMessages.push(message);
    return Promise.resolve();
  },
};

function fullNumber(number: number): string {
  return `2026-${number.toString().padStart(4, "0")}`;
}

describe("concurrent conventional document issue", () => {
  it("keeps numbering gapless, enforces remaining slots and locks company before series", async () => {
    const now = new Date("2026-07-30T10:00:00.000Z");
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const seriesId = crypto.randomUUID();
    const existingIssuedCount = 95;
    const concurrentAttemptCount = 12;
    const remainingSlots = 5;

    queuedMessages.length = 0;

    await database.insert(users).values({
      id: userId,
      name: "Concurrency Owner",
      email: "numbering-concurrency@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Numeración Concurrente, S.L.",
      taxId: "B12345678",
      address: "Calle Mayor 1, 28013 Madrid",
      email: "billing-concurrency@example.test",
      plan: "pro",
      retentionRate: "0.00",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(clients).values({
      id: clientId,
      companyId,
      name: "Cliente Concurrente, S.A.",
      taxId: "A87654321",
      address: "Avenida del Mar 5, Valencia",
      email: "client-concurrency@example.test",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(documentSeries).values({
      id: seriesId,
      companyId,
      documentType: "invoice",
      prefix: "2026-",
      nextNumber: existingIssuedCount + 1,
      isDefault: true,
    });

    const existingDocuments = Array.from(
      { length: existingIssuedCount },
      (_, index) => {
        const number = index + 1;
        return {
          id: crypto.randomUUID(),
          companyId,
          documentType: "invoice" as const,
          status: "issued" as const,
          seriesId,
          number,
          fullNumber: fullNumber(number),
          clientId,
          issueDate: "2026-07-01",
          pdfStatus: "ready" as const,
          issuedAt: new Date(
            `2026-07-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`,
          ),
          createdAt: now,
          updatedAt: now,
        };
      },
    );
    await database.insert(documents).values(existingDocuments);

    const draftDocumentIds = Array.from(
      { length: concurrentAttemptCount },
      () => crypto.randomUUID(),
    );
    await database.insert(documents).values(
      draftDocumentIds.map((id) => ({
        id,
        companyId,
        documentType: "invoice" as const,
        status: "draft" as const,
        clientId,
        issueDate: "2026-07-30",
        createdAt: now,
        updatedAt: now,
      })),
    );
    await database.insert(documentLines).values(
      draftDocumentIds.map((documentId, position) => ({
        id: crypto.randomUUID(),
        documentId,
        position: position + 1,
        description: `Servicio concurrente ${position + 1}`,
        quantity: "1.000",
        unitPriceCents: 10_000,
        taxRate: "21.00",
        discountPercentage: "0.00",
      })),
    );

    const attempts: IssueAttempt[] = draftDocumentIds.map((documentId) => {
      const lockOrder: LockResource[] = [];
      const promise: Promise<unknown> = issueDocument(
        {
          companyId,
          documentId,
          actor: userId,
        },
        {
          database,
          queue: pdfQueue,
          now,
          onLockAcquired(resource: LockResource) {
            lockOrder.push(resource);
            return Promise.resolve();
          },
        },
      );

      return { documentId, lockOrder, promise };
    });
    const settledResults = await Promise.allSettled(
      attempts.map((attempt) => attempt.promise),
    );
    const fulfilledAttempts = attempts.filter(
      (_, index) => settledResults[index]?.status === "fulfilled",
    );
    const rejectedAttempts = attempts.filter(
      (_, index) => settledResults[index]?.status === "rejected",
    );

    expect(fulfilledAttempts).toHaveLength(remainingSlots);
    expect(rejectedAttempts).toHaveLength(
      concurrentAttemptCount - remainingSlots,
    );

    for (const [index, result] of settledResults.entries()) {
      const attempt = attempts[index];
      if (!attempt) {
        throw new Error("No se ha encontrado el intento de emisión.");
      }

      if (result.status === "fulfilled") {
        expect(attempt.lockOrder).toEqual(["company", "document_series"]);
        continue;
      }

      expect(toApiError(result.reason)).toMatchObject({
        code: "plan_limit_reached",
        status: 402,
      });
      expect(attempt.lockOrder).toEqual(["company"]);
    }

    const allIssuedRows = await database
      .select({
        id: documents.id,
        number: documents.number,
        fullNumber: documents.fullNumber,
      })
      .from(documents)
      .where(
        inArray(documents.id, [
          ...existingDocuments.map((document) => document.id),
          ...draftDocumentIds,
        ]),
      )
      .orderBy(asc(documents.number));
    const numberedRows = allIssuedRows.filter(
      (
        row,
      ): row is {
        id: string;
        number: number;
        fullNumber: string;
      } => row.number !== null && row.fullNumber !== null,
    );
    const expectedNumbers = Array.from(
      { length: existingIssuedCount + remainingSlots },
      (_, index) => index + 1,
    );

    expect(numberedRows.map((row) => row.number)).toEqual(expectedNumbers);
    expect(new Set(numberedRows.map((row) => row.number)).size).toBe(
      expectedNumbers.length,
    );
    expect(numberedRows.map((row) => row.fullNumber)).toEqual(
      expectedNumbers.map(fullNumber),
    );

    const successfulIds = new Set(
      fulfilledAttempts.map((attempt) => attempt.documentId),
    );
    const rejectedIds = new Set(
      rejectedAttempts.map((attempt) => attempt.documentId),
    );
    const attemptedRows = await database
      .select({
        id: documents.id,
        status: documents.status,
        seriesId: documents.seriesId,
        number: documents.number,
        fullNumber: documents.fullNumber,
        pdfStatus: documents.pdfStatus,
        issuedAt: documents.issuedAt,
      })
      .from(documents)
      .where(inArray(documents.id, draftDocumentIds));

    for (const row of attemptedRows) {
      if (successfulIds.has(row.id)) {
        expect(row).toMatchObject({
          status: "issued",
          seriesId,
          pdfStatus: "pending",
        });
        expect(row.number).not.toBeNull();
        expect(row.fullNumber).not.toBeNull();
        expect(row.issuedAt).not.toBeNull();
        continue;
      }

      expect(rejectedIds.has(row.id)).toBe(true);
      expect(row).toEqual({
        id: row.id,
        status: "draft",
        seriesId: null,
        number: null,
        fullNumber: null,
        pdfStatus: null,
        issuedAt: null,
      });
    }

    const [persistedSeries] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, seriesId));
    expect(persistedSeries?.nextNumber).toBe(
      existingIssuedCount + remainingSlots + 1,
    );

    const issueEvents = await database
      .select({
        documentId: documentEvents.documentId,
        event: documentEvents.event,
      })
      .from(documentEvents)
      .where(inArray(documentEvents.documentId, draftDocumentIds));
    expect(issueEvents).toHaveLength(remainingSlots);
    expect(issueEvents.every((event) => event.event === "issued")).toBe(true);
    expect(new Set(issueEvents.map((event) => event.documentId))).toEqual(
      successfulIds,
    );

    const parsedQueueMessages = queuedMessages.map((message) =>
      pdfRenderMessageSchema.parse(message),
    );
    expect(parsedQueueMessages).toHaveLength(remainingSlots);
    expect(
      new Set(parsedQueueMessages.map((message) => message.documentId)),
    ).toEqual(successfulIds);
    for (const message of parsedQueueMessages) {
      expect(rejectedIds.has(message.documentId)).toBe(false);
    }
  });
});
