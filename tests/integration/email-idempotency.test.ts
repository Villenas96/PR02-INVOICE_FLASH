import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, documentEvents, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-email-idempotency-secret-at-least-32";

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { createOrReuseDocumentEmailDelivery } = await import(
  "@/services/email/deliveries"
);
const { createDocumentEmailHandler } = await import(
  "@/workers/handlers/email-send"
);
const { createEmailSendMessage } = await import("@/workers/messages");

async function createUser(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(users).values({
    id,
    name: "Owner",
    email: `owner-${crypto.randomUUID()}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createCompany(userId: string): Promise<string> {
  const companyId = crypto.randomUUID();
  const now = new Date();
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Empresa Idempotente, S.L.",
    taxId: "B12345678",
    address: "Calle de la Idempotencia 1, Madrid",
    email: `owner-${crypto.randomUUID()}@example.test`,
    plan: "pro",
    createdAt: now,
    updatedAt: now,
  });
  return companyId;
}

async function seedIssuedInvoice(companyId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(documents).values({
    id,
    companyId,
    documentType: "invoice",
    status: "issued",
    number: 1,
    fullNumber: "2026-0001",
    issueDate: now.toISOString().slice(0, 10),
    totalCents: 5_000,
    pdfStatus: "ready",
    issuedAt: now,
    issuerSnapshot: { legalName: "Empresa Idempotente, S.L." },
    clientSnapshot: { name: "Cliente" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("document email delivery idempotency", () => {
  let userId: string;
  let companyId: string;
  let documentId: string;

  beforeEach(async () => {
    userId = await createUser();
    companyId = await createCompany(userId);
    documentId = await seedIssuedInvoice(companyId);
  });

  it("returns the same delivery for a duplicate API request with the same idempotency key", async () => {
    const idempotencyKey = crypto.randomUUID();
    const first = await createOrReuseDocumentEmailDelivery({
      database,
      companyId,
      documentId,
      requestedBy: userId,
      recipientEmail: "cliente@example.test",
      customMessage: null,
      idempotencyKey,
    });
    const second = await createOrReuseDocumentEmailDelivery({
      database,
      companyId,
      documentId,
      requestedBy: userId,
      recipientEmail: "cliente@example.test",
      customMessage: null,
      idempotencyKey,
    });

    expect(second.id).toBe(first.id);
  });

  it("sends exactly once and records exactly one email_sent event across a duplicated queue message", async () => {
    const idempotencyKey = crypto.randomUUID();
    const delivery = await createOrReuseDocumentEmailDelivery({
      database,
      companyId,
      documentId,
      requestedBy: userId,
      recipientEmail: "cliente@example.test",
      customMessage: null,
      idempotencyKey,
    });

    const sendMock = vi.fn().mockResolvedValue({ id: "resend-message-1" });
    const handler = createDocumentEmailHandler({
      database,
      provider: { send: sendMock },
      appBaseUrl: "http://localhost:3000",
    });
    const message = createEmailSendMessage(delivery.id);

    await handler(message);
    await handler(message);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const events = await database
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, documentId));
    const sentEvents = events.filter((event) => event.event === "email_sent");
    expect(sentEvents).toHaveLength(1);
  });
});
