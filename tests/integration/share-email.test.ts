import { beforeEach, describe, expect, it, vi } from "vitest";

import { companies, documents, shareLinks, users } from "@/db/schema";
import type { PrivateBucket, R2ObjectBody } from "@/services/storage";

import { createIntegrationDatabase } from "./database";

const appBaseUrl = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-share-email-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = appBaseUrl;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({
  createDatabase: () => database,
}));
vi.mock("@/db/index", () => ({
  createDatabase: () => database,
}));
const { setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { GET: getPublicPdf } = await import("@/app/d/[token]/pdf/route");

class InMemoryPrivateBucket implements PrivateBucket {
  readonly objects = new Map<string, Uint8Array>();

  get(key: string): Promise<R2ObjectBody | null> {
    const value = this.objects.get(key);
    if (!value) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      body: new Blob([value.buffer as ArrayBuffer]).stream(),
      httpMetadata: { contentType: "application/pdf" },
    });
  }

  put(key: string, value: Uint8Array): Promise<void> {
    this.objects.set(key, value.slice());
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

let bucket = new InMemoryPrivateBucket();

function routeContext(token: string) {
  return { params: Promise.resolve({ token }) };
}

async function createCompany(userId: string): Promise<string> {
  const companyId = crypto.randomUUID();
  const now = new Date();
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: "Empresa Pública, S.L.",
    taxId: "B12345678",
    address: "Calle Pública 1, Madrid",
    email: `owner-${crypto.randomUUID()}@example.test`,
    createdAt: now,
    updatedAt: now,
  });
  return companyId;
}

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

async function seedDocument(
  companyId: string,
  overrides: {
    status: "issued" | "voided";
    pdfStatus: "pending" | "ready";
    number: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await database.insert(documents).values({
    id,
    companyId,
    documentType: "invoice",
    status: overrides.status,
    number: overrides.number,
    fullNumber: `2026-${overrides.number.toString().padStart(4, "0")}`,
    issueDate: now.toISOString().slice(0, 10),
    totalCents: 5_000,
    pdfStatus: overrides.pdfStatus,
    issuedAt: now,
    issuerSnapshot: { legalName: "Empresa Pública, S.L." },
    clientSnapshot: { name: "Cliente" },
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedShareLink(
  companyId: string,
  documentId: string,
  options: { disabled?: boolean } = {},
): Promise<string> {
  const token =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const now = new Date();
  await database.insert(shareLinks).values({
    id: crypto.randomUUID(),
    companyId,
    documentId,
    token,
    disabledAt: options.disabled ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return token;
}

describe("public share access", () => {
  beforeEach(async () => {
    bucket = new InMemoryPrivateBucket();
    cloudflareState.env = { STORAGE_BUCKET: bucket };
    setAuthEmailDeliveryHandler(() => Promise.resolve());
  });

  it("serves the stored PDF for a valid active token", async () => {
    const userId = await createUser();
    const companyId = await createCompany(userId);
    const documentId = await seedDocument(companyId, {
      status: "issued",
      pdfStatus: "ready",
      number: 1,
    });
    await bucket.put(
      `documents/${documentId}/pdf/v1.pdf`,
      new TextEncoder().encode("%PDF-1.4 fake"),
    );
    const token = await seedShareLink(companyId, documentId);

    const response = await getPublicPdf(
      new Request(`http://localhost:3000/d/${token}/pdf`),
      routeContext(token),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("returns 202 with Retry-After while the PDF is still pending", async () => {
    const userId = await createUser();
    const companyId = await createCompany(userId);
    const documentId = await seedDocument(companyId, {
      status: "issued",
      pdfStatus: "pending",
      number: 2,
    });
    const token = await seedShareLink(companyId, documentId);

    const response = await getPublicPdf(
      new Request(`http://localhost:3000/d/${token}/pdf`),
      routeContext(token),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("still serves a voided document's PDF through its active link", async () => {
    const userId = await createUser();
    const companyId = await createCompany(userId);
    const documentId = await seedDocument(companyId, {
      status: "voided",
      pdfStatus: "ready",
      number: 3,
    });
    await bucket.put(
      `documents/${documentId}/pdf/v1.pdf`,
      new TextEncoder().encode("%PDF-1.4 fake"),
    );
    const token = await seedShareLink(companyId, documentId);

    const response = await getPublicPdf(
      new Request(`http://localhost:3000/d/${token}/pdf`),
      routeContext(token),
    );
    expect(response.status).toBe(200);
  });

  it("returns a generic 404 for a disabled link", async () => {
    const userId = await createUser();
    const companyId = await createCompany(userId);
    const documentId = await seedDocument(companyId, {
      status: "issued",
      pdfStatus: "ready",
      number: 4,
    });
    const token = await seedShareLink(companyId, documentId, {
      disabled: true,
    });

    const response = await getPublicPdf(
      new Request(`http://localhost:3000/d/${token}/pdf`),
      routeContext(token),
    );
    expect(response.status).toBe(404);
    expect((await response.json()) as unknown).toEqual({
      error: {
        code: "resource_not_found",
        message: "No se ha encontrado el recurso solicitado.",
      },
    });
  });

  it("returns a generic 404 for an invented token", async () => {
    const response = await getPublicPdf(
      new Request(
        "http://localhost:3000/d/invented-token-that-does-not-exist/pdf",
      ),
      routeContext("invented-token-that-does-not-exist"),
    );
    expect(response.status).toBe(404);
  });
});
