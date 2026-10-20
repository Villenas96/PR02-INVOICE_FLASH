import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { documentLines, documents, taxRates } from "@/db/schema";
import {
  createCollectionMethod,
  updateCollectionMethod,
} from "@/services/collection-methods";
import { issueDocument } from "@/services/document-issuance";
import { createDraftDocument } from "@/services/documents";
import { createTaxRate, updateTaxRate } from "@/services/tax-rates";

import { createIntegrationDatabase } from "./database";
import {
  createOwner,
  createSeries,
  FIXTURE_NOW,
  recordingQueue,
} from "./fixtures";

const database = createIntegrationDatabase();

describe("frozen collection method and tax names", () => {
  it("issues with the default method and an IGI 4,5 % line exact to the cent, unchanged by later edits", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice");
    const account = await createCollectionMethod(database, owner.companyId, {
      kind: "bank_account",
      label: "Cuenta",
      holder_name: "Estudio Norte, S.L.",
      iban: "ES9121000418450200051332",
      bic: null,
      phone: null,
      email_or_url: null,
      instructions: null,
    });
    const igi = await createTaxRate(database, owner.companyId, {
      name: "IGI",
      rate: "4.5",
    });

    const draft = await createDraftDocument(
      {
        companyId: owner.companyId,
        actor: owner.userId,
        documentType: "invoice",
        clientId: owner.clientId,
        issueDate: "2026-07-30",
        lines: [
          {
            description: "Servicio",
            quantity: "1",
            unitPriceCents: 1_111,
            taxRate: igi.rate,
            taxName: igi.name,
            taxRateId: igi.id,
          },
        ],
      },
      { database },
    );
    expect(draft.collectionMethodId).toBe(account.id);

    const issued = await issueDocument(
      { companyId: owner.companyId, documentId: draft.id, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    );
    expect(issued.taxBreakdown).toEqual([
      { name: "IGI", rate: "4.50", baseCents: 1_111, taxCents: 50 },
    ]);
    expect(issued.totalCents).toBe(1_161);

    await updateTaxRate(database, owner.companyId, igi.id, { rate: "5" });
    await database
      .update(taxRates)
      .set({ archivedAt: FIXTURE_NOW })
      .where(eq(taxRates.id, igi.id));
    await updateCollectionMethod(database, owner.companyId, account.id, {
      label: "Cuenta renombrada",
      archived: true,
    });

    const [document] = await database
      .select()
      .from(documents)
      .where(eq(documents.id, draft.id));
    expect(document?.collectionMethodSnapshot).toEqual({
      kind: "bank_account",
      label: "Cuenta",
      holder: "Estudio Norte, S.L.",
      iban: "ES9121000418450200051332",
    });
    expect(document?.taxBreakdown).toEqual(issued.taxBreakdown);
    const [line] = await database
      .select()
      .from(documentLines)
      .where(eq(documentLines.documentId, draft.id));
    expect(line).toMatchObject({ taxName: "IGI", taxRate: "4.50" });
  });

  it("leaves the method empty when the draft chose none", async () => {
    const owner = await createOwner(database);
    await createSeries(database, owner.companyId, "invoice");
    await createCollectionMethod(database, owner.companyId, {
      kind: "cash",
      label: "Efectivo",
      holder_name: null,
      iban: null,
      bic: null,
      phone: null,
      email_or_url: null,
      instructions: null,
    });
    const draft = await createDraftDocument(
      {
        companyId: owner.companyId,
        actor: owner.userId,
        documentType: "invoice",
        clientId: owner.clientId,
        collectionMethodId: null,
        issueDate: "2026-07-30",
        lines: [
          {
            description: "Servicio",
            quantity: "1",
            unitPriceCents: 100,
            taxRate: "21",
          },
        ],
      },
      { database },
    );
    await issueDocument(
      { companyId: owner.companyId, documentId: draft.id, actor: owner.userId },
      { database, queue: recordingQueue(), now: FIXTURE_NOW },
    );
    const [document] = await database
      .select({ snapshot: documents.collectionMethodSnapshot })
      .from(documents)
      .where(eq(documents.id, draft.id));
    expect(document?.snapshot).toBeNull();
  });
});
