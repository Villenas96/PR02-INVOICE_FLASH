import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, utils } from "xlsx";

import { clients, companies, documents } from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import { createDraft, createSeries, recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
  type Tenant,
} from "./http";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { issueDocument } = await import("@/services/document-issuance");
const { GET: getXlsx } = await import("@/app/api/v1/documents/[id]/xlsx/route");

async function issuedInvoice(tenant: Tenant): Promise<string> {
  await createSeries(database, tenant.companyId, "invoice");
  const draft = await createDraft(database, tenant, {
    now: new Date(),
    issueDate: new Date().toISOString().slice(0, 10),
    unitPriceCents: 12_345,
  });
  await issueDocument(
    { companyId: tenant.companyId, documentId: draft, actor: tenant.userId },
    { database, queue: recordingQueue() },
  );
  return draft;
}

beforeEach(() => {
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

describe("document design", () => {
  it("freezes issuer and client logo keys at issue", async () => {
    const tenant = await createTenant(auth, database, "basic");
    const companyLogo = `logos/${tenant.companyId}/aaa.png`;
    const clientLogo = `logos/${tenant.companyId}/ccc.jpg`;
    await database
      .update(companies)
      .set({ logoKey: companyLogo })
      .where(eq(companies.id, tenant.companyId));
    await database
      .update(clients)
      .set({ logoKey: clientLogo })
      .where(eq(clients.id, tenant.clientId));
    const documentId = await issuedInvoice(tenant);

    await database
      .update(companies)
      .set({ logoKey: `logos/${tenant.companyId}/bbb.png` })
      .where(eq(companies.id, tenant.companyId));
    await database
      .update(clients)
      .set({ logoKey: null })
      .where(eq(clients.id, tenant.clientId));

    const [document] = await database
      .select({
        issuer: documents.issuerSnapshot,
        client: documents.clientSnapshot,
      })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document?.issuer).toMatchObject({ logoKey: companyLogo });
    expect(document?.client).toMatchObject({ logoKey: clientLogo });
  });

  it.each(["basic", "essential"] as const)(
    "refuses the per-document spreadsheet in %s",
    async (plan) => {
      const tenant = await createTenant(auth, database, plan);
      const documentId = await issuedInvoice(tenant);
      const response = await getXlsx(
        authenticatedRequest(tenant, `/api/v1/documents/${documentId}/xlsx`),
        routeContext({ id: documentId }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: {
          code: "feature_not_in_plan",
          details: { feature: "document_xlsx", required_plan: "pro" },
        },
      });
    },
  );

  it("downloads the spreadsheet in Pro with the stored totals", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const documentId = await issuedInvoice(tenant);
    const [stored] = await database
      .select({
        totalCents: documents.totalCents,
        subtotalCents: documents.subtotalCents,
        fullNumber: documents.fullNumber,
      })
      .from(documents)
      .where(eq(documents.id, documentId));

    const response = await getXlsx(
      authenticatedRequest(tenant, `/api/v1/documents/${documentId}/xlsx`),
      routeContext({ id: documentId }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      `${stored?.fullNumber}.xlsx`,
    );
    const workbook = read(new Uint8Array(await response.arrayBuffer()));
    const sheetName = workbook.SheetNames[0] as string;
    const rows = utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName] as never,
      { header: 1 },
    );
    expect(rows).toContainEqual(["Total", (stored?.totalCents ?? 0) / 100]);
    expect(rows).toContainEqual([
      "Base imponible",
      (stored?.subtotalCents ?? 0) / 100,
    ]);
  });
});
