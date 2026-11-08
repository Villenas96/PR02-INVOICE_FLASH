import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accessEvents,
  companies,
  companyAccess,
  documents,
  emailDeliveries,
} from "@/db/schema";
import { advisorInviteSeed, deriveSignedToken } from "@/lib/download-tokens";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
  signedInUser,
  type Tenant,
} from "./http";

const SECRET = "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_SECRET = SECRET;
process.env.BETTER_AUTH_URL = APP_BASE_URL;
process.env.APP_BASE_URL = APP_BASE_URL;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const accessRoute = await import("@/app/api/v1/advisor-access/route");
const revokeRoute = await import("@/app/api/v1/advisor-access/[id]/route");
const acceptRoute = await import(
  "@/app/api/v1/advisor-invitations/accept/route"
);
const myCompanies = await import("@/app/api/v1/me/companies/route");
const activeCompany = await import("@/app/api/v1/me/active-company/route");
const companyRoute = await import("@/app/api/v1/company/route");
const clientsRoute = await import("@/app/api/v1/clients/route");
const exportsRoute = await import("@/app/api/v1/exports/route");
const pdfRoute = await import("@/app/api/v1/documents/[id]/pdf/route");

let bucket: InMemoryBucket;

beforeEach(() => {
  bucket = new InMemoryBucket();
  cloudflareState.env = {
    STORAGE_BUCKET: bucket,
    EMAIL_SEND_QUEUE: recordingQueue(),
    JOBS_QUEUE: recordingQueue(),
  };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

interface Account {
  userId: string;
  email: string;
  cookie: string;
}

function json(
  user: { cookie: string },
  path: string,
  method: string,
  body?: unknown,
): Request {
  return authenticatedRequest(user, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function invite(owner: Tenant, email: string): Promise<string> {
  const response = await accessRoute.POST(
    json(owner, "/api/v1/advisor-access", "POST", { email }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function accept(account: Account, accessId: string): Promise<Response> {
  const { token } = await deriveSignedToken(
    SECRET,
    advisorInviteSeed(accessId),
  );
  return acceptRoute.POST(
    json(account, "/api/v1/advisor-invitations/accept", "POST", { token }),
  );
}

async function advisedPair() {
  const owner = await createTenant(auth, database, "pro");
  const advisor = await signedInUser(auth, database);
  const accessId = await invite(owner, advisor.email);
  const accepted = await accept(advisor, accessId);
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  return { owner, advisor, accessId };
}

async function companyAs(user: { cookie: string }) {
  const response = await companyRoute.GET(
    authenticatedRequest(user, "/api/v1/company"),
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("advisor access", () => {
  it("invites by email with a 7-day expiry and an opaque email payload", async () => {
    const owner = await createTenant(auth, database, "pro");
    const now = Date.now();
    const accessId = await invite(owner, "Gestoria@Example.test");
    const [access] = await database
      .select()
      .from(companyAccess)
      .where(eq(companyAccess.id, accessId));
    expect(access?.status).toBe("pending");
    const days =
      ((access?.inviteExpiresAt.getTime() ?? 0) - now) / (24 * 60 * 60 * 1_000);
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(JSON.stringify(access)).not.toContain("gestoria@example.test");

    const [delivery] = await database
      .select({
        recipient: emailDeliveries.recipientEmail,
        payload: emailDeliveries.payload,
      })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.idempotencyKey, `advisor_invite:${accessId}`));
    expect(delivery?.recipient).toBe("gestoria@example.test");
    expect(JSON.stringify(delivery?.payload)).not.toMatch(/token/i);
  });

  it("is Pro only", async () => {
    const essential = await createTenant(auth, database, "essential");
    const response = await accessRoute.POST(
      json(essential, "/api/v1/advisor-access", "POST", {
        email: "gestoria@example.test",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "feature_not_in_plan" },
    });
  });

  it("rejects expired invitations and accounts with another email", async () => {
    const owner = await createTenant(auth, database, "pro");
    const advisor = await signedInUser(auth, database);
    const stranger = await signedInUser(auth, database);
    const accessId = await invite(owner, advisor.email);

    expect((await accept(stranger, accessId)).status).toBe(409);

    await database
      .update(companyAccess)
      .set({ inviteExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(companyAccess.id, accessId));
    expect((await accept(advisor, accessId)).status).toBe(409);
  });

  it("accepts with another account, lands on the company and stays read-only", async () => {
    const { owner, advisor } = await advisedPair();

    const list = await myCompanies.GET(
      authenticatedRequest(advisor, "/api/v1/me/companies"),
    );
    expect(((await list.json()) as { items: unknown[] }).items).toEqual([
      {
        company_id: owner.companyId,
        legal_name: "Empresa de contrato, S.L.",
        role: "advisor",
        suspended: false,
      },
    ]);

    expect((await companyAs(advisor)).body).toMatchObject({
      id: owner.companyId,
      role: "advisor",
    });
    const clients = await clientsRoute.GET(
      authenticatedRequest(advisor, "/api/v1/clients"),
    );
    expect(clients.status).toBe(200);

    const write = await clientsRoute.POST(
      json(advisor, "/api/v1/clients", "POST", { name: "Intento" }),
    );
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({
      error: { code: "read_only_access" },
    });
    const companyWrite = await companyRoute.PUT(
      json(advisor, "/api/v1/company", "PUT", { phone: "600000000" }),
    );
    expect(companyWrite.status).toBe(403);

    await companyAs(advisor);
    const started = await database
      .select({ id: accessEvents.id })
      .from(accessEvents)
      .where(
        and(
          eq(accessEvents.companyId, owner.companyId),
          eq(accessEvents.actorUserId, advisor.userId),
          eq(accessEvents.action, "session_started"),
        ),
      );
    expect(started).toHaveLength(1);
  });

  it("switches between an own company and an advised one", async () => {
    const owner = await createTenant(auth, database, "pro");
    const advisorTenant = await createTenant(auth, database, "basic");
    const accessId = await invite(owner, advisorTenant.email);
    expect((await accept(advisorTenant, accessId)).status).toBe(200);
    expect((await companyAs(advisorTenant)).body).toMatchObject({
      id: owner.companyId,
      role: "advisor",
    });

    const back = await activeCompany.PUT(
      json(advisorTenant, "/api/v1/me/active-company", "PUT", {
        company_id: advisorTenant.companyId,
      }),
    );
    expect(back.status).toBe(200);
    expect((await companyAs(advisorTenant)).body).toMatchObject({
      id: advisorTenant.companyId,
      role: "owner",
    });

    const foreign = await createTenant(auth, database, "pro");
    const denied = await activeCompany.PUT(
      json(advisorTenant, "/api/v1/me/active-company", "PUT", {
        company_id: foreign.companyId,
      }),
    );
    expect(denied.status).toBe(404);
  });

  it("revocation takes effect on the very next request", async () => {
    const { owner, advisor, accessId } = await advisedPair();
    expect((await companyAs(advisor)).body).toMatchObject({
      id: owner.companyId,
    });
    const revoked = await revokeRoute.DELETE(
      json(owner, `/api/v1/advisor-access/${accessId}`, "DELETE"),
      routeContext({ id: accessId }),
    );
    expect(revoked.status).toBe(204);
    const after = await companyAs(advisor);
    expect(after.body.id).not.toBe(owner.companyId);
    expect(after.body.role).toBe("owner");
  });

  it("pauses the access while the company is not Pro, without deleting it", async () => {
    const { owner, advisor, accessId } = await advisedPair();
    await database
      .update(companies)
      .set({ plan: "essential" })
      .where(eq(companies.id, owner.companyId));
    const paused = await companyAs(advisor);
    expect(paused.status).toBe(403);
    expect(paused.body).toMatchObject({
      error: { code: "advisor_access_suspended" },
    });
    const [access] = await database
      .select({ status: companyAccess.status })
      .from(companyAccess)
      .where(eq(companyAccess.id, accessId));
    expect(access?.status).toBe("active");

    await database
      .update(companies)
      .set({ plan: "pro" })
      .where(eq(companies.id, owner.companyId));
    expect((await companyAs(advisor)).status).toBe(200);
  });

  it("records advisor exports and PDF downloads, visible to the owner", async () => {
    const { owner, advisor } = await advisedPair();
    const exported = await exportsRoute.POST(
      json(advisor, "/api/v1/exports", "POST", {
        kind: "period_excel",
        period: "previous_quarter",
      }),
    );
    expect(exported.status, await exported.clone().text()).toBe(202);
    const toAdvisor = await exportsRoute.POST(
      json(advisor, "/api/v1/exports", "POST", {
        kind: "period_excel",
        period: "previous_quarter",
        send_to_advisor: true,
      }),
    );
    expect(toAdvisor.status).toBe(403);

    const documentId = crypto.randomUUID();
    await database.insert(documents).values({
      id: documentId,
      companyId: owner.companyId,
      documentType: "invoice",
      status: "issued",
      number: 1,
      fullNumber: "2026-0001",
      issueDate: "2026-09-01",
      pdfStatus: "ready",
    });
    await bucket.put(`documents/${documentId}/pdf/v1.pdf`, "%PDF-1.7");
    const pdf = await pdfRoute.GET(
      authenticatedRequest(advisor, `/api/v1/documents/${documentId}/pdf`),
      routeContext({ id: documentId }),
    );
    expect(pdf.status).toBe(200);

    const log = await accessRoute.GET(
      authenticatedRequest(owner, "/api/v1/advisor-access"),
    );
    const body = (await log.json()) as {
      accesses: Array<{ status: string; email: string }>;
      events: Array<{ action: string; actor_email: string }>;
    };
    expect(body.accesses).toEqual([
      expect.objectContaining({ status: "active", email: advisor.email }),
    ]);
    expect(body.events.map((event) => event.action).sort()).toEqual([
      "downloaded_pdf",
      "exported",
      "session_started",
    ]);
    expect(new Set(body.events.map((event) => event.actor_email))).toEqual(
      new Set([advisor.email]),
    );

    const advisorLog = await accessRoute.GET(
      authenticatedRequest(advisor, "/api/v1/advisor-access"),
    );
    expect(advisorLog.status).toBe(403);
  });
});
