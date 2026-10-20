import type { Database } from "@/db";
import {
  clients,
  companies,
  documentLines,
  documentSeries,
  documents,
  users,
} from "@/db/schema";

export type FixturePlan = (typeof companies.$inferInsert)["plan"];
export type FixtureDocumentType =
  (typeof documents.$inferInsert)["documentType"];

export interface OwnerFixture {
  userId: string;
  companyId: string;
  clientId: string;
}

export const FIXTURE_NOW = new Date("2026-07-30T10:00:00.000Z");

/** Owner with complete fiscal data and one issuable client. */
export async function createOwner(
  database: Database,
  {
    plan = "basic",
    now = FIXTURE_NOW,
    email,
  }: { plan?: FixturePlan; now?: Date; email?: string } = {},
): Promise<OwnerFixture> {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();

  await database.insert(users).values({
    id: userId,
    name: "Fixture Owner",
    email: email ?? `${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Estudio Norte, S.L.",
    taxId: "B12345678",
    address: "Calle Mayor 1, 28013 Madrid",
    email: `billing-${companyId}@example.test`,
    plan,
    retentionRate: "0.00",
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente Ejemplo, S.A.",
    taxId: "A87654321",
    address: "Avenida del Mar 5, Valencia",
    email: "administracion@cliente.example",
    createdAt: now,
    updatedAt: now,
  });

  return { userId, companyId, clientId };
}

export async function createSeries(
  database: Database,
  companyId: string,
  documentType: FixtureDocumentType,
  {
    prefix,
    nextNumber = 1,
    isDefault = true,
  }: { prefix?: string; nextNumber?: number; isDefault?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(documentSeries).values({
    id,
    companyId,
    documentType,
    prefix: prefix ?? `${documentType.toUpperCase()}-2026-`,
    nextNumber,
    isDefault,
  });
  return id;
}

/** Draft with one valid line, ready to issue. */
export async function createDraft(
  database: Database,
  owner: OwnerFixture,
  {
    documentType = "invoice",
    now = FIXTURE_NOW,
    issueDate = "2026-07-30",
    unitPriceCents = 10_000,
  }: {
    documentType?: FixtureDocumentType;
    now?: Date;
    issueDate?: string;
    unitPriceCents?: number;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await database.insert(documents).values({
    id,
    companyId: owner.companyId,
    documentType,
    status: "draft",
    clientId: owner.clientId,
    issueDate,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(documentLines).values({
    id: crypto.randomUUID(),
    documentId: id,
    position: 1,
    description: "Servicio profesional",
    quantity: "1.000",
    unitPriceCents,
    taxRate: "21.00",
    discountPercentage: "0.00",
  });
  return id;
}

/**
 * Inserts `count` already-issued documents of one type in the month of
 * `issuedAt`, numbered from `startNumber` in `seriesId`, to pre-consume quota.
 */
export async function seedIssuedDocuments(
  database: Database,
  owner: OwnerFixture,
  {
    documentType,
    seriesId,
    count,
    issuedAt = FIXTURE_NOW,
    startNumber = 1,
    prefix,
    status = "issued",
  }: {
    documentType: FixtureDocumentType;
    seriesId: string;
    count: number;
    issuedAt?: Date;
    startNumber?: number;
    prefix?: string;
    status?: "issued" | "voided";
  },
): Promise<void> {
  if (count === 0) {
    return;
  }
  const seriesPrefix = prefix ?? `${documentType.toUpperCase()}-2026-`;
  await database.insert(documents).values(
    Array.from({ length: count }, (_, index) => {
      const number = startNumber + index;
      return {
        id: crypto.randomUUID(),
        companyId: owner.companyId,
        documentType,
        status,
        seriesId,
        number,
        fullNumber: `${seriesPrefix}${number.toString().padStart(4, "0")}`,
        clientId: owner.clientId,
        issueDate: issuedAt.toISOString().slice(0, 10),
        issuedAt,
        voidedAt: status === "voided" ? issuedAt : null,
        pdfStatus: "pending" as const,
        createdAt: issuedAt,
        updatedAt: issuedAt,
      };
    }),
  );
}

export function recordingQueue() {
  const messages: unknown[] = [];
  return {
    messages,
    send(message: unknown) {
      messages.push(message);
      return Promise.resolve();
    },
  };
}
