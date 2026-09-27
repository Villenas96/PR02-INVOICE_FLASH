import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  catalogItems,
  clients,
  companies,
  documentEvents,
  documents,
  emailDeliveries,
  payments,
  users,
} from "@/db/schema";

import { createIntegrationDatabase } from "./database";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-seed-test-secret-at-least-32-characters";

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { seedDemoData } = await import("@/db/seed");

const FREE_EMAIL = "demo-free@invoiceflash.test";
const PRO_EMAIL = "demo-pro@invoiceflash.test";

async function companyIdFor(email: string): Promise<string> {
  const [row] = await database
    .select({ companyId: companies.id })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(eq(users.email, email));
  if (!row) {
    throw new Error(`No se ha creado la empresa demo para ${email}.`);
  }
  return row.companyId;
}

async function issuedCountFor(companyId: string): Promise<number> {
  const rows = await database
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        inArray(documents.status, ["issued", "voided"]),
      ),
    );
  return rows.length;
}

describe("deterministic demo seed", () => {
  it("seeds a free-plan company at its 5/5 monthly boundary with varied documents and payments", async () => {
    const now = new Date();
    await seedDemoData({ database, now });

    const companyId = await companyIdFor(FREE_EMAIL);
    const [company] = await database
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, companyId));
    expect(company?.plan).toBe("free");
    expect(await issuedCountFor(companyId)).toBe(5);

    const companyClients = await database
      .select({ id: clients.id, archivedAt: clients.archivedAt })
      .from(clients)
      .where(eq(clients.companyId, companyId));
    expect(companyClients).toHaveLength(5);
    expect(companyClients.some((client) => client.archivedAt !== null)).toBe(
      true,
    );

    const companyCatalogItems = await database
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(eq(catalogItems.companyId, companyId));
    expect(companyCatalogItems.length).toBeGreaterThanOrEqual(6);

    const companyDocuments = await database
      .select({
        documentType: documents.documentType,
        status: documents.status,
        pdfStatus: documents.pdfStatus,
        convertedFromId: documents.convertedFromId,
      })
      .from(documents)
      .where(eq(documents.companyId, companyId));
    expect(
      companyDocuments.some((document) => document.documentType === "invoice"),
    ).toBe(true);
    expect(
      companyDocuments.some((document) => document.documentType === "proforma"),
    ).toBe(true);
    expect(
      companyDocuments.some((document) => document.documentType === "receipt"),
    ).toBe(true);
    expect(
      companyDocuments.some((document) => document.convertedFromId !== null),
    ).toBe(true);
    expect(
      companyDocuments.some((document) => document.pdfStatus === "ready"),
    ).toBe(true);
    expect(
      companyDocuments.some((document) => document.pdfStatus === "failed"),
    ).toBe(true);

    const companyPayments = await database
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.companyId, companyId));
    expect(companyPayments.length).toBeGreaterThanOrEqual(1);

    const issuedEvents = await database
      .select({ event: documentEvents.event })
      .from(documentEvents)
      .where(eq(documentEvents.companyId, companyId));
    expect(issuedEvents.some((row) => row.event === "issued")).toBe(true);
  });

  it("seeds a pro-plan company at its 100/100 monthly boundary with a voided document and a sent email", async () => {
    const now = new Date();
    await seedDemoData({ database, now });

    const companyId = await companyIdFor(PRO_EMAIL);
    const [company] = await database
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, companyId));
    expect(company?.plan).toBe("pro");
    expect(await issuedCountFor(companyId)).toBe(100);

    const voidedDocuments = await database
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), eq(documents.status, "voided")),
      );
    expect(voidedDocuments.length).toBeGreaterThanOrEqual(1);

    const sentDeliveries = await database
      .select({ id: emailDeliveries.id, status: emailDeliveries.status })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.companyId, companyId));
    expect(sentDeliveries.some((row) => row.status === "sent")).toBe(true);
  });

  it("is idempotent: seeding a second time does not create duplicate companies or users", async () => {
    const now = new Date();
    await seedDemoData({ database, now });
    const firstRunUsers = await database
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, [FREE_EMAIL, PRO_EMAIL]));

    await seedDemoData({ database, now });
    const secondRunUsers = await database
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, [FREE_EMAIL, PRO_EMAIL]));

    expect(secondRunUsers).toHaveLength(2);
    expect(new Set(secondRunUsers.map((row) => row.id))).toEqual(
      new Set(firstRunUsers.map((row) => row.id)),
    );
  });
});
