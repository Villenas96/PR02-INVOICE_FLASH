import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentSeries,
  documents,
  payments,
  users,
} from "@/db/schema";
import { apiErrorResponse } from "@/lib/api/errors";
import {
  type CompanyContext,
  ResourceNotFoundError,
  resolveCompanyResource,
} from "@/services/context";

import { createIntegrationDatabase } from "./database";

interface TenantFixture {
  context: CompanyContext;
  companyId: string;
  clientId: string;
  documentId: string;
  seriesId: string;
  paymentId: string;
}

interface ResourceCase {
  name: string;
  idFrom: (fixture: TenantFixture) => string;
  load: (
    resourceId: string,
  ) => (companyId: string) => Promise<{ id: string } | undefined>;
}

const db = createIntegrationDatabase();

async function seedTenant(label: string): Promise<TenantFixture> {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    name: `User ${label}`,
    email: `${label}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    userId,
    email: `${label}@example.test`,
    legalName: `Company ${label}`,
  });
  await db.insert(clients).values({
    id: clientId,
    companyId,
    name: `Client ${label}`,
  });
  await db.insert(documentSeries).values({
    id: seriesId,
    companyId,
    documentType: "invoice",
    prefix: `${label.toUpperCase()}-`,
    isDefault: true,
  });
  await db.insert(documents).values({
    id: documentId,
    companyId,
    documentType: "invoice",
    status: "issued",
    seriesId,
    number: 1,
    fullNumber: `${label.toUpperCase()}-1`,
    clientId,
    issueDate: "2026-07-30",
    issuedAt: now,
  });
  await db.insert(payments).values({
    id: paymentId,
    companyId,
    documentId,
    amountCents: 100,
    paidOn: "2026-07-30",
  });

  return {
    context: { userId, companyId },
    companyId,
    clientId,
    documentId,
    seriesId,
    paymentId,
  };
}

function loadCompany(resourceId: string) {
  return async (companyId: string) => {
    const [row] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.id, resourceId)));

    return row;
  };
}

function loadClient(resourceId: string) {
  return async (companyId: string) => {
    const [row] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.id, resourceId)));

    return row;
  };
}

function loadDocument(resourceId: string) {
  return async (companyId: string) => {
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), eq(documents.id, resourceId)),
      );

    return row;
  };
}

function loadSeries(resourceId: string) {
  return async (companyId: string) => {
    const [row] = await db
      .select({ id: documentSeries.id })
      .from(documentSeries)
      .where(
        and(
          eq(documentSeries.companyId, companyId),
          eq(documentSeries.id, resourceId),
        ),
      );

    return row;
  };
}

function loadPayment(resourceId: string) {
  return async (companyId: string) => {
    const [row] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.companyId, companyId), eq(payments.id, resourceId)),
      );

    return row;
  };
}

const resourceCases: ResourceCase[] = [
  {
    name: "company",
    idFrom: (fixture) => fixture.companyId,
    load: loadCompany,
  },
  { name: "client", idFrom: (fixture) => fixture.clientId, load: loadClient },
  {
    name: "document",
    idFrom: (fixture) => fixture.documentId,
    load: loadDocument,
  },
  {
    name: "series",
    idFrom: (fixture) => fixture.seriesId,
    load: loadSeries,
  },
  {
    name: "payment",
    idFrom: (fixture) => fixture.paymentId,
    load: loadPayment,
  },
];

async function expectGenericNotFound(
  operation: () => Promise<unknown>,
): Promise<void> {
  let caughtError: unknown;

  try {
    await operation();
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toBeInstanceOf(ResourceNotFoundError);

  const response = apiErrorResponse(caughtError);
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "resource_not_found",
      message: "No se ha encontrado el recurso solicitado.",
    },
  });
}

describe("company-scoped authorization", () => {
  let owner: TenantFixture;
  let foreignTenant: TenantFixture;

  beforeEach(async () => {
    owner = await seedTenant("owner");
    foreignTenant = await seedTenant("foreign");
  });

  it("denies by default when the scoped loader finds no resource", async () => {
    let receivedCompanyId: string | undefined;

    await expectGenericNotFound(() =>
      resolveCompanyResource(owner.context, (companyId) => {
        receivedCompanyId = companyId;
        return Promise.resolve(undefined);
      }),
    );

    expect(receivedCompanyId).toBe(owner.companyId);
  });

  it.each(resourceCases)(
    "returns a generic 404 for a foreign $name id",
    async ({ idFrom, load }) => {
      const ownResourceId = idFrom(owner);
      const foreignResourceId = idFrom(foreignTenant);

      await expect(
        resolveCompanyResource(owner.context, load(ownResourceId)),
      ).resolves.toEqual({ id: ownResourceId });

      await expectGenericNotFound(() =>
        resolveCompanyResource(owner.context, load(foreignResourceId)),
      );
    },
  );
});
