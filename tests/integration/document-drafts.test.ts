import { asc, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  clients,
  companies,
  documentEvents,
  documentLines,
  documents,
  users,
} from "@/db/schema";
import { ResourceNotFoundError } from "@/services/context";
import {
  createDraftDocument,
  getDocumentDetail,
  softDeleteDraftDocument,
  updateDraftDocument,
} from "@/services/documents";

import { createIntegrationDatabase } from "./database";

const database = createIntegrationDatabase();
const now = new Date("2026-07-30T12:00:00.000Z");

interface DraftFixture {
  actor: string;
  clientId: string;
  companyId: string;
}

async function seedDraftFixture(): Promise<DraftFixture> {
  const actor = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();

  await database.insert(users).values({
    id: actor,
    name: "Draft Integration User",
    email: `${actor}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(companies).values({
    id: companyId,
    userId: actor,
    email: `${companyId}@example.test`,
    retentionRate: "15.00",
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(clients).values({
    id: clientId,
    companyId,
    name: "Cliente del borrador",
    createdAt: now,
    updatedAt: now,
  });

  return { actor, companyId, clientId };
}

describe("draft document lifecycle", () => {
  it("recomputes cents, appends events and preserves audit on soft-delete", async () => {
    const fixture = await seedDraftFixture();
    const created = await createDraftDocument(
      {
        companyId: fixture.companyId,
        actor: fixture.actor,
        documentType: "invoice",
        clientId: fixture.clientId,
        issueDate: "2026-07-30",
        lines: [
          {
            description: "Consultoría",
            quantity: "2.000",
            unitPriceCents: 1_000,
            taxRate: "21.00",
            discountPercentage: "10.00",
          },
          {
            description: "Formación",
            quantity: "1.000",
            unitPriceCents: 500,
            taxRate: "10.00",
          },
        ],
      },
      { database, now },
    );

    expect(created).toMatchObject({
      companyId: fixture.companyId,
      status: "draft",
      subtotalCents: 2_300,
      retentionRate: "15.00",
      retentionCents: 345,
      totalCents: 2_383,
    });
    expect(created.lines).toHaveLength(2);

    const updated = await updateDraftDocument(
      {
        companyId: fixture.companyId,
        documentId: created.id,
        actor: fixture.actor,
        notes: "Actualizado",
        lines: [
          {
            description: "Servicio final",
            quantity: "1.000",
            unitPriceCents: 10_000,
            taxRate: "21.00",
          },
        ],
      },
      { database, now: new Date("2026-07-30T12:05:00.000Z") },
    );

    expect(updated).toMatchObject({
      notes: "Actualizado",
      subtotalCents: 10_000,
      retentionCents: 1_500,
      totalCents: 10_600,
    });
    expect(updated.lines).toHaveLength(1);

    await softDeleteDraftDocument(
      {
        companyId: fixture.companyId,
        documentId: created.id,
        actor: fixture.actor,
      },
      { database, now: new Date("2026-07-30T12:10:00.000Z") },
    );

    await expect(
      getDocumentDetail({
        database,
        companyId: fixture.companyId,
        documentId: created.id,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    const [persistedDocument] = await database
      .select()
      .from(documents)
      .where(eq(documents.id, created.id));
    const persistedLines = await database
      .select()
      .from(documentLines)
      .where(eq(documentLines.documentId, created.id));
    const events = await database
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, created.id))
      .orderBy(asc(documentEvents.createdAt));

    expect(persistedDocument?.deletedAt).toEqual(
      new Date("2026-07-30T12:10:00.000Z"),
    );
    expect(persistedLines).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({ event: "created", payload: null }),
      expect.objectContaining({ event: "updated", payload: null }),
      expect.objectContaining({
        event: "updated",
        payload: { operation: "draft_deleted" },
      }),
    ]);
  });

  it("keeps document, lines and event atomic when an integer total overflows", async () => {
    const fixture = await seedDraftFixture();

    await expect(
      createDraftDocument(
        {
          companyId: fixture.companyId,
          actor: fixture.actor,
          documentType: "invoice",
          clientId: fixture.clientId,
          issueDate: "2026-07-30",
          lines: [
            {
              description: "Importe fuera del rango Postgres",
              quantity: "2.000",
              unitPriceCents: 2_147_483_647,
              taxRate: "0.00",
            },
          ],
        },
        { database, now },
      ),
    ).rejects.toThrow();

    const [[documentCount], [eventCount], [lineCount]] = await Promise.all([
      database
        .select({ value: count() })
        .from(documents)
        .where(eq(documents.companyId, fixture.companyId)),
      database
        .select({ value: count() })
        .from(documentEvents)
        .where(eq(documentEvents.companyId, fixture.companyId)),
      database.select({ value: count() }).from(documentLines),
    ]);

    expect(Number(documentCount?.value ?? 0)).toBe(0);
    expect(Number(eventCount?.value ?? 0)).toBe(0);
    expect(Number(lineCount?.value ?? 0)).toBe(0);
  });

  it("returns 404 for foreign clients and refuses issued document mutations", async () => {
    const owner = await seedDraftFixture();
    const foreign = await seedDraftFixture();

    await expect(
      createDraftDocument(
        {
          companyId: owner.companyId,
          actor: owner.actor,
          documentType: "invoice",
          clientId: foreign.clientId,
          issueDate: "2026-07-30",
          lines: [],
        },
        { database, now },
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    const draft = await createDraftDocument(
      {
        companyId: owner.companyId,
        actor: owner.actor,
        documentType: "invoice",
        clientId: owner.clientId,
        issueDate: "2026-07-30",
        lines: [],
      },
      { database, now },
    );
    await database
      .update(documents)
      .set({
        status: "issued",
        number: 1,
        fullNumber: "2026-0001",
        issuedAt: now,
      })
      .where(eq(documents.id, draft.id));

    await expect(
      updateDraftDocument(
        {
          companyId: owner.companyId,
          documentId: draft.id,
          actor: owner.actor,
          notes: "No permitido",
        },
        { database, now },
      ),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expect(
      softDeleteDraftDocument(
        {
          companyId: owner.companyId,
          documentId: draft.id,
          actor: owner.actor,
        },
        { database, now },
      ),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
  });
});
