import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentLines,
  documentSeries,
  documents,
  users,
} from "@/db/schema";
import { issueDocument } from "@/services/document-issuance";
import { getDocumentDetail } from "@/services/documents";
import { renderDocumentPdf } from "@/services/pdf/render";
import type { DocumentPdfInput } from "@/services/pdf/template";

import { createIntegrationDatabase } from "./database";

const database = createIntegrationDatabase();
const issuedAt = new Date("2026-07-30T11:00:00.000Z");

interface IssuedDocumentDetail {
  documentType: "invoice";
  fullNumber: string;
  issueDate: string;
  dueDate: string;
  notes: string | null;
  subtotalCents: number;
  taxBreakdown: Array<{
    rate: string;
    baseCents: number;
    taxCents: number;
  }>;
  retentionRate: string;
  retentionCents: number;
  totalCents: number;
  issuerSnapshot: {
    legalName: string;
    taxId: string;
    address: string;
    email: string;
    phone: string | null;
    logoKey: string | null;
  };
  clientSnapshot: {
    name: string;
    taxId: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
  };
  lines: Array<{
    position: number;
    description: string;
    quantity: string;
    unitPriceCents: number;
    taxRate: string;
    lineSubtotalCents: number;
    lineTaxCents: number;
    lineTotalCents: number;
  }>;
}

function toPdfInput(detail: IssuedDocumentDetail): DocumentPdfInput {
  return {
    documentType: detail.documentType,
    fullNumber: detail.fullNumber,
    issueDate: detail.issueDate,
    dueDate: detail.dueDate,
    currency: "EUR",
    issuer: {
      legalName: detail.issuerSnapshot.legalName,
      taxId: detail.issuerSnapshot.taxId,
      addressLines: [detail.issuerSnapshot.address],
      email: detail.issuerSnapshot.email,
    },
    client: {
      legalName: detail.clientSnapshot.name,
      taxId: detail.clientSnapshot.taxId ?? "",
      addressLines: detail.clientSnapshot.address
        ? [detail.clientSnapshot.address]
        : [],
      email: detail.clientSnapshot.email,
    },
    lines: detail.lines,
    subtotalCents: detail.subtotalCents,
    taxBreakdown: detail.taxBreakdown,
    retentionRate: detail.retentionRate,
    retentionCents: detail.retentionCents,
    totalCents: detail.totalCents,
    notes: detail.notes,
  };
}

async function seedSnapshotFixture() {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const documentId = crypto.randomUUID();

  await database.insert(users).values({
    id: userId,
    name: "Snapshot Integration User",
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Emisor original, S.L.",
    taxId: "B11111111",
    address: "Calle Original 1, Madrid",
    email: "original@emisor.example",
    phone: "+34 910 111 111",
    logoKey: `companies/${companyId}/original.svg`,
    retentionRate: "0.00",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente estable, S.A.",
    taxId: "A22222222",
    address: "Avenida Cliente 2, Sevilla",
    email: "cliente@example.test",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(documentSeries).values({
    id: seriesId,
    companyId,
    documentType: "invoice",
    prefix: "F-",
    nextNumber: 7,
    isDefault: true,
  });
  await database.insert(documents).values({
    id: documentId,
    companyId,
    documentType: "invoice",
    status: "draft",
    clientId,
    issueDate: "2026-07-30",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  await database.insert(documentLines).values({
    id: crypto.randomUUID(),
    documentId,
    position: 1,
    description: "Servicio profesional",
    quantity: "1.000",
    unitPriceCents: 10_000,
    taxRate: "21.00",
    discountPercentage: "0.00",
  });

  return { userId, companyId, documentId };
}

describe("immutable issuer snapshot", () => {
  it("keeps issued API and PDF data unchanged after editing the company", async () => {
    const fixture = await seedSnapshotFixture();
    const queue = { send: () => Promise.resolve() };

    await issueDocument(
      {
        companyId: fixture.companyId,
        documentId: fixture.documentId,
        actor: fixture.userId,
      },
      { database, queue, now: issuedAt },
    );

    const apiBeforeEdit = await getDocumentDetail<IssuedDocumentDetail>({
      database,
      companyId: fixture.companyId,
      documentId: fixture.documentId,
    });
    const pdfBeforeEdit = await renderDocumentPdf(toPdfInput(apiBeforeEdit));

    await database
      .update(companies)
      .set({
        legalName: "Emisor cambiado, S.L.",
        taxId: "B99999999",
        address: "Calle Nueva 99, Barcelona",
        email: "nuevo@emisor.example",
        phone: "+34 930 999 999",
        logoKey: `companies/${fixture.companyId}/new.svg`,
        updatedAt: new Date("2026-07-31T09:00:00.000Z"),
      })
      .where(eq(companies.id, fixture.companyId));

    const apiAfterEdit = await getDocumentDetail<IssuedDocumentDetail>({
      database,
      companyId: fixture.companyId,
      documentId: fixture.documentId,
    });
    const pdfAfterEdit = await renderDocumentPdf(toPdfInput(apiAfterEdit));
    const [persistedDocument] = await database
      .select({
        issuerSnapshot: documents.issuerSnapshot,
      })
      .from(documents)
      .where(eq(documents.id, fixture.documentId))
      .limit(1);

    expect(apiBeforeEdit.issuerSnapshot).toEqual({
      legalName: "Emisor original, S.L.",
      taxId: "B11111111",
      address: "Calle Original 1, Madrid",
      email: "original@emisor.example",
      phone: "+34 910 111 111",
      logoKey: `companies/${fixture.companyId}/original.svg`,
    });
    expect(apiAfterEdit).toEqual(apiBeforeEdit);
    expect(persistedDocument.issuerSnapshot).toEqual(
      apiBeforeEdit.issuerSnapshot,
    );
    expect(pdfBeforeEdit.byteLength).toBeGreaterThan(0);
    expect(pdfAfterEdit).toEqual(pdfBeforeEdit);
  });
});
