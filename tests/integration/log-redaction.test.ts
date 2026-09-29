import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { companies, documents, users } from "@/db/schema";

import { createIntegrationDatabase } from "./database";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-log-redaction-secret-at-least-32-characters";

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

const RECIPIENT_EMAIL = "cliente.secreto@example.test";
const COMPANY_TAX_ID = "B87654321";

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
    legalName: "Empresa Redacción, S.L.",
    taxId: COMPANY_TAX_ID,
    address: "Calle de la Redacción 1, Madrid",
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
    issuerSnapshot: {
      legalName: "Empresa Redacción, S.L.",
      taxId: COMPANY_TAX_ID,
    },
    clientSnapshot: { name: "Cliente" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("public and email logs never leak tokens, tax ids or recipients", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function allLoggedText(): string {
    const calls = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    return calls.map((call) => call.map(String).join(" ")).join("\n");
  }

  it("never logs the recipient email or company tax id, on success or failure", async () => {
    const userId = await createUser();
    const companyId = await createCompany(userId);
    const documentId = await seedIssuedInvoice(companyId);

    const failingDelivery = await createOrReuseDocumentEmailDelivery({
      database,
      companyId,
      documentId,
      requestedBy: userId,
      recipientEmail: RECIPIENT_EMAIL,
      customMessage: null,
      idempotencyKey: crypto.randomUUID(),
    });
    const failingHandler = createDocumentEmailHandler({
      database,
      provider: { send: () => Promise.reject(new Error("boom")) },
      appBaseUrl: "http://localhost:3000",
    });
    await expect(
      failingHandler(createEmailSendMessage(failingDelivery.id)),
    ).rejects.toThrow();

    const succeedingDelivery = await createOrReuseDocumentEmailDelivery({
      database,
      companyId,
      documentId,
      requestedBy: userId,
      recipientEmail: RECIPIENT_EMAIL,
      customMessage: null,
      idempotencyKey: crypto.randomUUID(),
    });
    const succeedingHandler = createDocumentEmailHandler({
      database,
      provider: { send: () => Promise.resolve({ id: "resend-1" }) },
      appBaseUrl: "http://localhost:3000",
    });
    await succeedingHandler(createEmailSendMessage(succeedingDelivery.id));

    const logged = allLoggedText();
    expect(logged).not.toContain(RECIPIENT_EMAIL);
    expect(logged).not.toContain(COMPANY_TAX_ID);
  });
});
