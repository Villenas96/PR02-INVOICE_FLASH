import { asc, eq } from "drizzle-orm";
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
import { issueDocument } from "@/services/document-issuance";
import { pdfRenderMessageSchema } from "@/workers/messages";

import { createIntegrationDatabase } from "./database";

interface IssueFixture {
  companyId: string;
  documentId: string;
  lineIds: [string, string];
  seriesId: string;
  userId: string;
}

const database = createIntegrationDatabase();
const issuedAt = new Date("2026-07-30T10:15:00.000Z");

async function seedIssueFixture({
  conflictingNumber = false,
}: {
  conflictingNumber?: boolean;
} = {}): Promise<IssueFixture> {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const lineIds: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];

  await database.insert(users).values({
    id: userId,
    name: "Issue Integration User",
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Estudio Norte, S.L.",
    taxId: "B12345678",
    address: "Calle Mayor 1, 28013 Madrid",
    email: "facturacion@estudio-norte.example",
    phone: "+34 910 000 000",
    logoKey: `companies/${companyId}/logo.svg`,
    defaultDueDays: 30,
    retentionRate: "15.00",
    plan: "free",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente Ejemplo, S.A.",
    taxId: "A87654321",
    address: "Avenida del Mar 5, Valencia",
    email: "administracion@cliente.example",
    phone: "+34 960 000 000",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(documentSeries).values({
    id: seriesId,
    companyId,
    documentType: "invoice",
    prefix: "2026-",
    nextNumber: 1,
    isDefault: true,
  });
  await database.insert(documents).values({
    id: documentId,
    companyId,
    documentType: "invoice",
    status: "draft",
    clientId,
    issueDate: "2026-07-09",
    dueDate: null,
    notes: "Pago mediante transferencia.",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(documentLines).values([
    {
      id: lineIds[0],
      documentId,
      position: 1,
      description: "Consultoría técnica",
      quantity: "2.000",
      unitPriceCents: 1_000,
      taxRate: "21.00",
      discountPercentage: "10.00",
    },
    {
      id: lineIds[1],
      documentId,
      position: 2,
      description: "Formación",
      quantity: "1.000",
      unitPriceCents: 500,
      taxRate: "10.00",
      discountPercentage: "0.00",
    },
  ]);

  if (conflictingNumber) {
    await database.insert(documents).values({
      id: crypto.randomUUID(),
      companyId,
      documentType: "invoice",
      status: "issued",
      seriesId,
      number: 1,
      fullNumber: "2026-0001",
      clientId,
      issueDate: "2026-07-01",
      issuedAt,
      pdfStatus: "pending",
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
  }

  return { userId, companyId, seriesId, documentId, lineIds };
}

describe("atomic document issue", () => {
  it("commits totals, number, snapshots, event and PDF state as one issue", async () => {
    const fixture = await seedIssueFixture();
    const queuedMessages: unknown[] = [];
    const queue = {
      send(message: unknown) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
    };

    await issueDocument(
      {
        companyId: fixture.companyId,
        documentId: fixture.documentId,
        actor: fixture.userId,
      },
      { database, queue, now: issuedAt },
    );

    const [document] = await database
      .select()
      .from(documents)
      .where(eq(documents.id, fixture.documentId))
      .limit(1);
    const lines = await database
      .select()
      .from(documentLines)
      .where(eq(documentLines.documentId, fixture.documentId))
      .orderBy(asc(documentLines.position));
    const [series] = await database
      .select()
      .from(documentSeries)
      .where(eq(documentSeries.id, fixture.seriesId))
      .limit(1);
    const events = await database
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, fixture.documentId));

    expect(document).toMatchObject({
      status: "issued",
      seriesId: fixture.seriesId,
      number: 1,
      fullNumber: "2026-0001",
      dueDate: "2026-08-08",
      subtotalCents: 2_300,
      retentionRate: "15.00",
      retentionCents: 345,
      totalCents: 2_383,
      pdfStatus: "pending",
      issuedAt,
      issuerSnapshot: {
        legalName: "Estudio Norte, S.L.",
        taxId: "B12345678",
        address: "Calle Mayor 1, 28013 Madrid",
        email: "facturacion@estudio-norte.example",
        phone: "+34 910 000 000",
        logoKey: `companies/${fixture.companyId}/logo.svg`,
      },
      clientSnapshot: {
        name: "Cliente Ejemplo, S.A.",
        taxId: "A87654321",
        address: "Avenida del Mar 5, Valencia",
        email: "administracion@cliente.example",
        phone: "+34 960 000 000",
      },
    });
    expect(document.taxBreakdown).toEqual(
      expect.arrayContaining([
        { rate: "10.00", baseCents: 500, taxCents: 50 },
        { rate: "21.00", baseCents: 1_800, taxCents: 378 },
      ]),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        id: fixture.lineIds[0],
        lineSubtotalCents: 1_800,
        lineTaxCents: 378,
        lineTotalCents: 2_178,
      }),
      expect.objectContaining({
        id: fixture.lineIds[1],
        lineSubtotalCents: 500,
        lineTaxCents: 50,
        lineTotalCents: 550,
      }),
    ]);
    expect(series.nextNumber).toBe(2);
    expect(events).toEqual([
      expect.objectContaining({
        companyId: fixture.companyId,
        documentId: fixture.documentId,
        actor: fixture.userId,
        event: "issued",
      }),
    ]);
    expect(queuedMessages).toHaveLength(1);
    expect(pdfRenderMessageSchema.parse(queuedMessages[0])).toMatchObject({
      type: "pdf.render",
      documentId: fixture.documentId,
    });
  });

  it("rolls back every issue effect when the number cannot be committed", async () => {
    const fixture = await seedIssueFixture({ conflictingNumber: true });
    const queuedMessages: unknown[] = [];
    const queue = {
      send(message: unknown) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
    };

    await expect(
      issueDocument(
        {
          companyId: fixture.companyId,
          documentId: fixture.documentId,
          actor: fixture.userId,
        },
        { database, queue, now: issuedAt },
      ),
    ).rejects.toThrow();

    const [document] = await database
      .select()
      .from(documents)
      .where(eq(documents.id, fixture.documentId))
      .limit(1);
    const [series] = await database
      .select()
      .from(documentSeries)
      .where(eq(documentSeries.id, fixture.seriesId))
      .limit(1);
    const events = await database
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, fixture.documentId));

    expect(document).toMatchObject({
      status: "draft",
      seriesId: null,
      number: null,
      fullNumber: null,
      subtotalCents: 0,
      taxBreakdown: [],
      retentionCents: 0,
      totalCents: 0,
      issuerSnapshot: null,
      clientSnapshot: null,
      pdfStatus: null,
      issuedAt: null,
    });
    expect(series.nextNumber).toBe(1);
    expect(events).toHaveLength(0);
    expect(queuedMessages).toHaveLength(0);
  });
});
