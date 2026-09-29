import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documentSeries,
  documents,
  users,
} from "@/db/schema";
import type { ApiError } from "@/lib/api/errors";
import { voidIssuedDocument } from "@/services/document-void";

import { createIntegrationDatabase } from "./database";

const database = createIntegrationDatabase();
const now = new Date("2026-07-30T15:00:00.000Z");

async function seedVoidFixture() {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const issuedDocumentId = crypto.randomUUID();
  const draftDocumentId = crypto.randomUUID();

  await database.insert(users).values({
    id: userId,
    name: "Void Integration User",
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Emisor de anulación, S.L.",
    taxId: "B12345678",
    address: "Calle de la Prueba 1, Madrid",
    email: "void@example.test",
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente de anulación",
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(documentSeries).values({
    id: seriesId,
    companyId,
    documentType: "invoice",
    prefix: "VOID-",
    nextNumber: 2,
    isDefault: true,
  });
  await database.insert(documents).values([
    {
      id: issuedDocumentId,
      companyId,
      documentType: "invoice",
      status: "issued",
      seriesId,
      number: 1,
      fullNumber: "VOID-0001",
      clientId,
      issueDate: "2026-07-30",
      subtotalCents: 10_000,
      taxBreakdown: [{ rate: "21.00", baseCents: 10_000, taxCents: 2_100 }],
      totalCents: 12_100,
      pdfStatus: "ready",
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: draftDocumentId,
      companyId,
      documentType: "invoice",
      status: "draft",
      clientId,
      issueDate: "2026-07-30",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return { userId, companyId, issuedDocumentId, draftDocumentId };
}

describe("issued document voiding", () => {
  it("voids once without changing issued content and appends one audit event", async () => {
    const fixture = await seedVoidFixture();
    const voidedAt = new Date("2026-07-31T09:30:00.000Z");

    const voided = await voidIssuedDocument({
      database,
      companyId: fixture.companyId,
      documentId: fixture.issuedDocumentId,
      actor: fixture.userId,
      now: voidedAt,
    });

    expect(voided).toMatchObject({
      id: fixture.issuedDocumentId,
      status: "voided",
      seriesId: expect.any(String),
      number: 1,
      fullNumber: "VOID-0001",
      subtotalCents: 10_000,
      totalCents: 12_100,
      pdfStatus: "ready",
      issuedAt: now,
      voidedAt,
      deletedAt: null,
    });
    await expect(
      database
        .select({
          actor: documentEvents.actor,
          event: documentEvents.event,
        })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, fixture.issuedDocumentId)),
    ).resolves.toEqual([
      {
        actor: fixture.userId,
        event: "voided",
      },
    ]);

    await expect(
      voidIssuedDocument({
        database,
        companyId: fixture.companyId,
        documentId: fixture.issuedDocumentId,
        actor: fixture.userId,
        now: voidedAt,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    } satisfies Partial<ApiError>);
    await expect(
      voidIssuedDocument({
        database,
        companyId: fixture.companyId,
        documentId: fixture.draftDocumentId,
        actor: fixture.userId,
        now: voidedAt,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    } satisfies Partial<ApiError>);

    await expect(
      database
        .select({ id: documentEvents.id })
        .from(documentEvents)
        .where(eq(documentEvents.documentId, fixture.draftDocumentId)),
    ).resolves.toHaveLength(0);
  });
});
