import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  catalogItems,
  clients,
  documentLines,
  documentSeries,
  documents,
  taxRates,
} from "@/db/schema";
import { toApiError } from "@/lib/api/errors";
import { issueDocument } from "@/services/document-issuance";
import {
  createDraftDocument,
  duplicateDocument,
  updateDraftDocument,
} from "@/services/documents";
import { ensureDefaultSeries } from "@/services/series";
import { listActiveTaxRates } from "@/services/tax-rates";

import { createIntegrationDatabase } from "./database";
import {
  createDraft,
  createOwner,
  createSeries,
  FIXTURE_NOW,
  recordingQueue,
} from "./fixtures";

const database = createIntegrationDatabase();

async function seriesOf(companyId: string, type: "proforma" | "receipt") {
  return database
    .select()
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, companyId),
        eq(documentSeries.documentType, type),
      ),
    );
}

describe("automatic default series", () => {
  it("creates exactly one series under concurrency, derived from the invoice prefix", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice", {
      prefix: "2026-",
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureDefaultSeries(database, owner.companyId, "proforma"),
      ),
    );

    const created = results.filter((result) => result.created);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ prefix: "PRO-2026-", renamed: false });
    const rows = await seriesOf(owner.companyId, "proforma");
    expect(rows).toEqual([
      expect.objectContaining({ prefix: "PRO-2026-", isDefault: true }),
    ]);
  });

  it("renames the prefix when it collides with an existing series", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice", {
      prefix: "2026-",
    });
    await createSeries(database, owner.companyId, "invoice", {
      prefix: "REC-2026-",
      isDefault: false,
    });

    const result = await ensureDefaultSeries(
      database,
      owner.companyId,
      "receipt",
    );

    expect(result).toMatchObject({
      created: true,
      prefix: "REC2-2026-",
      renamed: true,
    });
  });

  it("creates the series when the first draft of a type is saved", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice", {
      prefix: "F-",
    });

    const draft = await createDraftDocument(
      {
        companyId: owner.companyId,
        actor: owner.userId,
        documentType: "proforma",
        clientId: owner.clientId,
        issueDate: "2026-07-30",
        lines: [
          {
            description: "Servicio",
            quantity: "1",
            unitPriceCents: 1_000,
            taxRate: "21.00",
          },
        ],
      },
      { database },
    );

    expect(draft.seriesCreated).toEqual({ prefix: "PRO-F-", renamed: false });
    expect(await seriesOf(owner.companyId, "proforma")).toHaveLength(1);
  });
});

describe("draft series change", () => {
  it("only accepts active series of the same type and issues with the chosen one", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice");
    const alternative = await createSeries(
      database,
      owner.companyId,
      "invoice",
      {
        prefix: "B-",
        isDefault: false,
        nextNumber: 7,
      },
    );
    const archived = await createSeries(database, owner.companyId, "invoice", {
      prefix: "OLD-",
      isDefault: false,
    });
    await database
      .update(documentSeries)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(documentSeries.id, archived));
    const proformaSeries = await createSeries(
      database,
      owner.companyId,
      "proforma",
    );
    const draftId = await createDraft(database, owner);

    const wrongType = await updateDraftDocument(
      {
        companyId: owner.companyId,
        documentId: draftId,
        actor: owner.userId,
        seriesId: proformaSeries,
      },
      { database },
    ).catch((error: unknown) => toApiError(error));
    expect(wrongType).toMatchObject({ status: 400, code: "validation_error" });

    const archivedChoice = await updateDraftDocument(
      {
        companyId: owner.companyId,
        documentId: draftId,
        actor: owner.userId,
        seriesId: archived,
      },
      { database },
    ).catch((error: unknown) => toApiError(error));
    expect(archivedChoice).toMatchObject({
      status: 409,
      code: "series_archived",
    });

    await updateDraftDocument(
      {
        companyId: owner.companyId,
        documentId: draftId,
        actor: owner.userId,
        seriesId: alternative,
      },
      { database },
    );
    const issued = await issueDocument(
      { companyId: owner.companyId, documentId: draftId, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    );
    expect(issued).toMatchObject({
      seriesId: alternative,
      number: 7,
      fullNumber: "B-0007",
    });
  });

  it("rejects issuing with a series archived after it was chosen", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice");
    const chosen = await createSeries(database, owner.companyId, "invoice", {
      prefix: "B-",
      isDefault: false,
    });
    const draftId = await createDraft(database, owner);
    await updateDraftDocument(
      {
        companyId: owner.companyId,
        documentId: draftId,
        actor: owner.userId,
        seriesId: chosen,
      },
      { database },
    );
    await database
      .update(documentSeries)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(documentSeries.id, chosen));

    const error = await issueDocument(
      { companyId: owner.companyId, documentId: draftId, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    ).catch((caught: unknown) => toApiError(caught));

    expect(error).toMatchObject({ status: 409, code: "series_archived" });
    const [draft] = await database
      .select({ status: documents.status, number: documents.number })
      .from(documents)
      .where(eq(documents.id, draftId));
    expect(draft).toEqual({ status: "draft", number: null });
    const [series] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, chosen));
    expect(series?.nextNumber).toBe(1);
  });
});

describe("duplicate", () => {
  it("duplicates an issued invoice to a dated-today draft with archived-data warnings", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice");
    const [tax] = (await listActiveTaxRates(database, owner.companyId)).filter(
      (rate) => rate.rate === "10.00",
    );
    const itemId = crypto.randomUUID();
    await database.insert(catalogItems).values({
      id: itemId,
      companyId: owner.companyId,
      description: "Producto",
      unitPriceCents: 1_000,
      taxRate: "10.00",
    });
    const draftId = await createDraft(database, owner);
    await database
      .update(documentLines)
      .set({ taxRateId: tax?.id, catalogItemId: itemId, unit: "hora" })
      .where(eq(documentLines.documentId, draftId));
    await issueDocument(
      { companyId: owner.companyId, documentId: draftId, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    );
    await database
      .update(clients)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(clients.id, owner.clientId));
    await database
      .update(catalogItems)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(catalogItems.id, itemId));
    await database
      .update(taxRates)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(taxRates.id, tax?.id ?? ""));

    const today = new Date("2026-09-15T10:00:00.000Z");
    const { document, warnings } = await duplicateDocument(
      {
        companyId: owner.companyId,
        documentId: draftId,
        actor: owner.userId,
      },
      { database, now: today },
    );

    expect(document).toMatchObject({
      documentType: "invoice",
      status: "draft",
      clientId: null,
      issueDate: "2026-09-15",
      dueDate: null,
      number: null,
    });
    expect(warnings.sort()).toEqual([
      "client_archived",
      "product_archived",
      "tax_archived",
    ]);
    expect(document.lines).toEqual([
      expect.objectContaining({
        description: "Servicio profesional",
        unit: "hora",
        catalogItemId: null,
        taxRateId: null,
      }),
    ]);
  });

  it("refuses to duplicate receipts", async () => {
    const owner = await createOwner(database);
    const draftId = await createDraft(database, owner, {
      documentType: "receipt",
    });
    const error = await duplicateDocument(
      { companyId: owner.companyId, documentId: draftId, actor: owner.userId },
      { database },
    ).catch((caught: unknown) => toApiError(caught));
    expect(error).toMatchObject({ status: 409 });
  });
});
