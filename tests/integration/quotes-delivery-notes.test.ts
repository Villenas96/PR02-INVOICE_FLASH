import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  documentLines,
  documentLinks,
  documentSeries,
  documents,
} from "@/db/schema";
import { toApiError } from "@/lib/api/errors";
import {
  invoiceDeliveryNotes,
  invoiceDeliveryNotesAndIssue,
} from "@/services/delivery-note-invoicing";
import {
  convertAndIssue,
  convertDocument,
} from "@/services/document-conversion";
import { issueDocument } from "@/services/document-issuance";
import { voidIssuedDocument } from "@/services/document-void";
import { decideQuote } from "@/services/quote-decision";

import { createIntegrationDatabase } from "./database";
import {
  convertedTargetIds,
  createDraft,
  createOwner,
  createSeries,
  type OwnerFixture,
  recordingQueue,
  seedIssuedDocuments,
} from "./fixtures";

const database = createIntegrationDatabase();
const NOW = new Date("2026-08-15T10:00:00.000Z");

async function issued(
  owner: OwnerFixture,
  documentType: "quote" | "delivery_note" | "proforma",
  prefix: string,
): Promise<string> {
  await createSeries(database, owner.companyId, documentType, { prefix });
  const draft = await createDraft(database, owner, {
    documentType,
    now: NOW,
    issueDate: "2026-08-15",
  });
  const result = await issueDocument(
    { companyId: owner.companyId, documentId: draft, actor: owner.userId },
    { database, queue: recordingQueue(), now: NOW },
  );
  return result.id;
}

async function issueNote(owner: OwnerFixture, label: string): Promise<string> {
  const draft = await createDraft(database, owner, {
    documentType: "delivery_note",
    now: NOW,
    issueDate: "2026-08-15",
  });
  await database
    .update(documentLines)
    .set({ description: label })
    .where(eq(documentLines.documentId, draft));
  const result = await issueDocument(
    { companyId: owner.companyId, documentId: draft, actor: owner.userId },
    { database, queue: recordingQueue(), now: NOW },
  );
  return result.id;
}

const base = (owner: OwnerFixture, documentId: string) => ({
  database,
  companyId: owner.companyId,
  documentId,
  actor: owner.userId,
  now: NOW,
});

describe("quotes and delivery notes", () => {
  it("number in their own series, independent from invoices", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const invoiceSeries = await createSeries(
      database,
      owner.companyId,
      "invoice",
    );
    const quoteId = await issued(owner, "quote", "PRE-");
    const noteId = await issued(owner, "delivery_note", "ALB-");
    const rows = await database
      .select({ id: documents.id, fullNumber: documents.fullNumber })
      .from(documents)
      .where(eq(documents.companyId, owner.companyId));
    expect(rows.find((row) => row.id === quoteId)?.fullNumber).toBe("PRE-0001");
    expect(rows.find((row) => row.id === noteId)?.fullNumber).toBe("ALB-0001");
    const [series] = await database
      .select({ nextNumber: documentSeries.nextNumber })
      .from(documentSeries)
      .where(eq(documentSeries.id, invoiceSeries));
    expect(series?.nextNumber).toBe(1);
  });

  it("converts a quote to a proforma, delivery note and invoice; repeats need confirmation", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const quoteId = await issued(owner, "quote", "PRE-");

    const proforma = await convertDocument({
      ...base(owner, quoteId),
      targetType: "proforma",
    });
    const note = await convertDocument({
      ...base(owner, quoteId),
      targetType: "delivery_note",
    });
    expect(proforma.id).not.toBe(note.id);

    const repeat = await convertDocument({
      ...base(owner, quoteId),
      targetType: "proforma",
    }).catch((error) => toApiError(error));
    expect(repeat).toMatchObject({
      code: "conversion_repeat_confirmation_required",
      status: 409,
    });
    const confirmed = await convertDocument({
      ...base(owner, quoteId),
      targetType: "proforma",
      confirmRepeat: true,
    });
    expect(confirmed.id).not.toBe(proforma.id);
    expect(await convertedTargetIds(database, quoteId)).toHaveLength(3);
  });

  it("refuses conversions outside the table and from voided documents", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const proformaId = await issued(owner, "proforma", "PRO-");
    const outsideTable = await convertDocument({
      ...base(owner, proformaId),
      targetType: "delivery_note",
    }).catch((error) => toApiError(error));
    expect(outsideTable).toMatchObject({ code: "conversion_not_allowed" });

    await voidIssuedDocument({ ...base(owner, proformaId) });
    const voided = await convertDocument({
      ...base(owner, proformaId),
      targetType: "invoice",
    }).catch((error) => toApiError(error));
    expect(voided).toMatchObject({ code: "conversion_not_allowed" });
  });

  it("issues the conversion through the destination type quota (402) and replays idempotently", async () => {
    const owner = await createOwner(database, { plan: "basic" });
    const quoteId = await issued(owner, "quote", "PRE-");
    const invoiceSeries = await createSeries(
      database,
      owner.companyId,
      "invoice",
    );

    const first = await convertAndIssue(
      {
        ...base(owner, quoteId),
        targetType: "invoice",
        idempotencyKey: "quote-to-invoice-key-01",
      },
      { database, queue: recordingQueue(), now: NOW },
    );
    const replay = await convertAndIssue(
      {
        ...base(owner, quoteId),
        targetType: "invoice",
        idempotencyKey: "quote-to-invoice-key-01",
      },
      { database, queue: recordingQueue(), now: NOW },
    );
    expect(replay.id).toBe(first.id);

    // Exhaust the Basic invoice quota (5 per month) and try another.
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: invoiceSeries,
      count: 4,
      startNumber: 100,
      issuedAt: NOW,
    });
    const blocked = await convertAndIssue(
      {
        ...base(owner, quoteId),
        targetType: "invoice",
        confirmRepeat: true,
        idempotencyKey: "quote-to-invoice-key-02",
      },
      { database, queue: recordingQueue(), now: NOW },
    ).catch((error) => toApiError(error));
    expect(blocked).toMatchObject({ code: "plan_limit_reached", status: 402 });
  });

  it("records quote decisions only on issued quotes", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const quoteId = await issued(owner, "quote", "PRE-");
    const decided = await decideQuote({
      database,
      companyId: owner.companyId,
      documentId: quoteId,
      actor: owner.userId,
      decision: "accepted",
    });
    expect(decided.decision).toBe("accepted");

    const draft = await createDraft(database, owner, { documentType: "quote" });
    const refused = await decideQuote({
      database,
      companyId: owner.companyId,
      documentId: draft,
      actor: owner.userId,
      decision: "accepted",
    }).catch((error) => toApiError(error));
    expect(refused).toMatchObject({ status: 409 });
  });
});

describe("invoicing delivery notes", () => {
  it("builds one invoice from two notes with lines grouped per note", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "delivery_note", {
      prefix: "ALB-",
    });
    await createSeries(database, owner.companyId, "invoice");
    const first = await issueNote(owner, "Entrega uno");
    const second = await issueNote(owner, "Entrega dos");

    const invoice = await invoiceDeliveryNotes({
      ...base(owner, first),
      deliveryNoteIds: [first, second],
      idempotencyKey: "invoice-two-notes-key-1",
    });
    const lines = await database
      .select({
        description: documentLines.description,
        sectionLabel: documentLines.sectionLabel,
      })
      .from(documentLines)
      .where(eq(documentLines.documentId, invoice.id));
    expect(lines.map((line) => line.description).sort()).toEqual([
      "Entrega dos",
      "Entrega uno",
    ]);
    expect(
      lines.every((line) => line.sectionLabel?.startsWith("Albarán ALB-")),
    ).toBe(true);
    const [total] = await database
      .select({ totalCents: documents.totalCents })
      .from(documents)
      .where(eq(documents.id, invoice.id));
    expect(total?.totalCents).toBe(24_200);

    const replay = await invoiceDeliveryNotes({
      ...base(owner, first),
      deliveryNoteIds: [second, first],
      idempotencyKey: "invoice-two-notes-key-1",
    });
    expect(replay.id).toBe(invoice.id);
  });

  it("blocks invoicing a note twice with the invoice number, even concurrently", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "delivery_note", {
      prefix: "ALB-",
    });
    await createSeries(database, owner.companyId, "invoice");
    const note = await issueNote(owner, "Entrega");

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        invoiceDeliveryNotesAndIssue(
          {
            ...base(owner, note),
            deliveryNoteIds: [note],
            idempotencyKey: `concurrent-invoice-key-${index}`,
          },
          { database, queue: recordingQueue(), now: NOW },
        ),
      ),
    );
    const won = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(won).toHaveLength(1);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(toApiError(attempt.reason).code).toBe(
          "delivery_note_already_invoiced",
        );
      }
    }
    const winner = won[0] as PromiseFulfilledResult<{ fullNumber: string }>;

    const again = await invoiceDeliveryNotes({
      ...base(owner, note),
      deliveryNoteIds: [note],
      idempotencyKey: "another-request-key-001",
    }).catch((error) => toApiError(error));
    expect(again).toMatchObject({
      code: "delivery_note_already_invoiced",
      details: { invoice_number: winner.value.fullNumber },
    });
  });

  it("rejects notes of different clients", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    const other = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "delivery_note", {
      prefix: "A-",
    });
    await createSeries(database, other.companyId, "delivery_note", {
      prefix: "B-",
    });
    const mine = await issueNote(owner, "Mía");
    const foreign = await issueNote(other, "Ajena");
    const result = await invoiceDeliveryNotes({
      ...base(owner, mine),
      deliveryNoteIds: [mine, foreign],
      idempotencyKey: "mixed-notes-key-0001",
    }).catch((error) => toApiError(error));
    // A note of another company is invisible (404), never mixed in.
    expect(result).toMatchObject({ message: expect.any(String) });
    expect(
      await database
        .select({ id: documentLinks.id })
        .from(documentLinks)
        .where(eq(documentLinks.sourceDocumentId, foreign)),
    ).toEqual([]);
  });

  it("voiding the invoice releases the notes so they can be invoiced again", async () => {
    const owner = await createOwner(database, { plan: "pro" });
    await createSeries(database, owner.companyId, "delivery_note", {
      prefix: "ALB-",
    });
    await createSeries(database, owner.companyId, "invoice");
    const note = await issueNote(owner, "Entrega");
    const invoice = await invoiceDeliveryNotesAndIssue(
      {
        ...base(owner, note),
        deliveryNoteIds: [note],
        idempotencyKey: "void-release-key-00001",
      },
      { database, queue: recordingQueue(), now: NOW },
    );
    await voidIssuedDocument({ ...base(owner, invoice.id) });

    const live = await database
      .select({ releasedAt: documentLinks.releasedAt })
      .from(documentLinks)
      .where(
        and(
          eq(documentLinks.sourceDocumentId, note),
          eq(documentLinks.kind, "invoiced"),
        ),
      );
    expect(live.every((link) => link.releasedAt !== null)).toBe(true);

    const second = await invoiceDeliveryNotes({
      ...base(owner, note),
      deliveryNoteIds: [note],
      idempotencyKey: "void-release-key-00002",
    });
    expect(second.id).not.toBe(invoice.id);
  });
});
