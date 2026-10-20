import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aiConnections,
  bankStatements,
  bankTransactions,
  catalogItems,
  collectionMethods,
  companies,
  documentSeries,
  documents,
  exportJobs,
  importJobs,
  oauthClients,
  payments,
  reconciliations,
  recurringTemplates,
  sampleRenders,
  taxRates,
  userNotifications,
} from "@/db/schema";
import { advisorInviteSeed, deriveSignedToken } from "@/lib/download-tokens";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { recordingQueue } from "./fixtures";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  signedInUser,
  type Tenant,
} from "./http";

/**
 * Permission matrix (contracts/api.md, SC-011) over every handler under
 * `src/app/api/v1/**`: new routes are covered automatically.
 */

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

// While `holdBodies` is on, request bodies never finish parsing: a route
// that checks access first still answers; one that parses first hangs.
const bodyState = vi.hoisted(() => ({ holdBodies: false }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return {
    ...actual,
    parseJson: (...args: Parameters<typeof actual.parseJson>) =>
      bodyState.holdBodies
        ? new Promise<never>(() => {})
        : actual.parseJson(...args),
  };
});

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { auth, setAuthEmailDeliveryHandler } = await import("@/lib/auth");
const { POST: acceptInvitation } = await import(
  "@/app/api/v1/advisor-invitations/accept/route"
);
const { POST: inviteAdvisor } = await import(
  "@/app/api/v1/advisor-access/route"
);

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

interface RouteHandler {
  path: string;
  method: Method;
  access: "read" | "write" | "session";
  load: () => Promise<Handler>;
}

const MODULES = import.meta.glob<Record<string, Handler>>(
  "/src/app/api/v1/**/route.ts",
);
const SOURCES = import.meta.glob<string>("/src/app/api/v1/**/route.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Handlers that act on the user, not on a company. */
const SESSION_ONLY = new Set([
  "POST /advisor-invitations/accept",
  "GET /me/companies",
  "PUT /me/active-company",
]);
/** Non-GET handlers that are reads by contract. */
const READ_MUTATIONS = new Set([
  "POST /exports",
  "POST /notifications/:id/read",
]);
/** Reads reserved to the owner (subscription, advisor management). */
const OWNER_ONLY_READS = new Set([
  "GET /advisor-access",
  "GET /ai-connections",
  "GET /advisor-schedule",
  "GET /billing/subscription",
]);

function routeHandlers(): RouteHandler[] {
  const handlers: RouteHandler[] = [];
  for (const [file, source] of Object.entries(SOURCES)) {
    const path = file
      .replace("/src/app/api/v1", "")
      .replace("/route.ts", "")
      .replaceAll("[id]", ":id");
    const blocks = source.split(
      /export async function (GET|POST|PUT|PATCH|DELETE)\(/,
    );
    for (let index = 1; index < blocks.length; index += 2) {
      const method = blocks[index] as Method;
      const body = blocks[index + 1] ?? "";
      const declared = [...body.matchAll(/access: "(read|write)"/g)].map(
        (match) => match[1],
      );
      const key = `${method} ${path}`;
      handlers.push({
        path,
        method,
        access: SESSION_ONLY.has(key)
          ? "session"
          : ((declared[0] ?? "missing") as "read" | "write"),
        load: async () => {
          const module = await (
            MODULES[file] as () => Promise<Record<string, Handler>>
          )();
          return module[method] as Handler;
        },
      });
    }
  }
  return handlers.sort((left, right) =>
    `${left.path} ${left.method}`.localeCompare(
      `${right.path} ${right.method}`,
    ),
  );
}

const HANDLERS = routeHandlers();
const companyHandlers = HANDLERS.filter(
  (handler) => handler.access !== "session",
);
const key = (handler: RouteHandler) => `${handler.method} ${handler.path}`;

async function call(
  handler: RouteHandler,
  user: { cookie: string },
  id: string = crypto.randomUUID(),
): Promise<{ status: number; code?: string }> {
  const fn = await handler.load();
  const path = `/api/v1${handler.path.replace(":id", id)}`;
  const request = authenticatedRequest(user, path, {
    method: handler.method,
    ...(handler.method === "GET" || handler.method === "DELETE"
      ? {}
      : { body: "{}" }),
  });
  const response = await Promise.race([
    fn(request, { params: Promise.resolve({ id }) }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`${key(handler)} reads the body before checking access`),
          ),
        3_000,
      ),
    ),
  ]);
  const text = await response.text();
  let code: string | undefined;
  try {
    code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
  } catch {
    code = undefined;
  }
  return { status: response.status, code };
}

// The integration setup truncates the database before every test, so each
// matrix row builds its own fixtures and checks every handler in a loop,
// reporting all mismatches at once.

interface AdvisedCompany {
  owner: Tenant;
  advisor: { userId: string; email: string; cookie: string };
}

async function advisedCompany(): Promise<AdvisedCompany> {
  cloudflareState.env = {
    STORAGE_BUCKET: new InMemoryBucket(),
    EMAIL_SEND_QUEUE: recordingQueue(),
    JOBS_QUEUE: recordingQueue(),
    PDF_RENDER_QUEUE: recordingQueue(),
  };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
  const owner = await createTenant(auth, database, "pro");
  const advisor = await signedInUser(auth, database);
  const invite = await inviteAdvisor(
    authenticatedRequest(owner, "/api/v1/advisor-access", {
      method: "POST",
      body: JSON.stringify({ email: advisor.email }),
    }),
  );
  const { id } = (await invite.json()) as { id: string };
  const { token } = await deriveSignedToken(SECRET, advisorInviteSeed(id));
  const accepted = await acceptInvitation(
    authenticatedRequest(advisor, "/api/v1/advisor-invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  );
  expect(accepted.status).toBe(200);
  return { owner, advisor };
}

async function mismatches(
  handlers: RouteHandler[],
  check: (handler: RouteHandler) => Promise<string | null>,
): Promise<string[]> {
  const found: string[] = [];
  for (const handler of handlers) {
    try {
      const problem = await check(handler);
      if (problem) {
        found.push(`${key(handler)}: ${problem}`);
      }
    } catch (error) {
      found.push(`${key(handler)}: ${String(error)}`);
    }
  }
  return found;
}

function describeResult(result: { status: number; code?: string }): string {
  return `${result.status} ${result.code ?? ""}`.trim();
}

beforeEach(() => {
  bodyState.holdBodies = false;
});

describe("route declarations", () => {
  it("discovers the API handlers", () => {
    expect(HANDLERS.length).toBeGreaterThan(60);
  });

  it("every handler declares the access level its method implies", () => {
    const wrong = HANDLERS.filter((handler) => {
      if (handler.access === "session") {
        return false;
      }
      const expected =
        handler.method === "GET" || READ_MUTATIONS.has(key(handler))
          ? "read"
          : "write";
      return handler.access !== expected;
    }).map((handler) => `${key(handler)} declares ${handler.access}`);
    expect(wrong).toEqual([]);
  });
});

describe("advisor on a Pro company", () => {
  it("every write route answers 403 read_only_access before reading the body", async () => {
    const { advisor } = await advisedCompany();
    bodyState.holdBodies = true;
    const writes = companyHandlers.filter(
      (handler) => handler.access === "write",
    );
    expect(writes.length).toBeGreaterThan(30);
    expect(
      await mismatches(writes, async (handler) => {
        const result = await call(handler, advisor);
        return result.status === 403 && result.code === "read_only_access"
          ? null
          : describeResult(result);
      }),
    ).toEqual([]);
  });

  it("every read route is readable, except the owner-only ones", async () => {
    const { advisor } = await advisedCompany();
    const reads = companyHandlers.filter(
      (handler) => handler.access === "read",
    );
    expect(
      await mismatches(reads, async (handler) => {
        const result = await call(handler, advisor);
        if (OWNER_ONLY_READS.has(key(handler))) {
          return result.status === 403 && result.code === "read_only_access"
            ? null
            : `owner-only read answered ${describeResult(result)}`;
        }
        return result.status >= 500 ||
          result.code === "read_only_access" ||
          result.code === "advisor_access_suspended"
          ? describeResult(result)
          : null;
      }),
    ).toEqual([]);
  });
});

describe("advisor on a company without Pro", () => {
  it("every route answers 403 advisor_access_suspended", async () => {
    const { owner, advisor } = await advisedCompany();
    await database
      .update(companies)
      .set({ plan: "essential" })
      .where(eq(companies.id, owner.companyId));
    bodyState.holdBodies = true;
    expect(
      await mismatches(companyHandlers, async (handler) => {
        const result = await call(handler, advisor);
        return result.status === 403 &&
          result.code === "advisor_access_suspended"
          ? null
          : describeResult(result);
      }),
    ).toEqual([]);
  });
});

async function foreignResources(): Promise<{
  stranger: Tenant;
  ids: Record<string, string>;
}> {
  cloudflareState.env = {
    STORAGE_BUCKET: new InMemoryBucket(),
    EMAIL_SEND_QUEUE: recordingQueue(),
    JOBS_QUEUE: recordingQueue(),
    PDF_RENDER_QUEUE: recordingQueue(),
  };
  setAuthEmailDeliveryHandler(() => Promise.resolve());
  const stranger = await createTenant(auth, database, "pro");
  const foreign = await createTenant(auth, database, "pro");
  const companyId = foreign.companyId;
  const documentId = crypto.randomUUID();
  await database.insert(documents).values({
    id: documentId,
    companyId,
    documentType: "invoice",
    status: "issued",
    number: 1,
    fullNumber: "F-0001",
    issueDate: "2026-09-01",
    totalCents: 1_000,
    pdfStatus: "ready",
  });
  const [catalogItem] = await database
    .insert(catalogItems)
    .values({
      id: crypto.randomUUID(),
      companyId,
      description: "Ajeno",
      unitPriceCents: 100,
      taxRate: "21.00",
    })
    .returning({ id: catalogItems.id });
  const [series] = await database
    .insert(documentSeries)
    .values({
      id: crypto.randomUUID(),
      companyId,
      documentType: "invoice",
      prefix: "F-",
      nextNumber: 2,
      isDefault: false,
    })
    .returning({ id: documentSeries.id });
  const [tax] = await database
    .insert(taxRates)
    .values({ id: crypto.randomUUID(), companyId, name: "IGIC", rate: "7.00" })
    .returning({ id: taxRates.id });
  const [method] = await database
    .insert(collectionMethods)
    .values({
      id: crypto.randomUUID(),
      companyId,
      kind: "other",
      label: "Ajeno",
    })
    .returning({ id: collectionMethods.id });
  const [payment] = await database
    .insert(payments)
    .values({
      id: crypto.randomUUID(),
      companyId,
      documentId,
      amountCents: 100,
      paidOn: "2026-09-02",
    })
    .returning({ id: payments.id });
  const [importJob] = await database
    .insert(importJobs)
    .values({
      id: crypto.randomUUID(),
      companyId,
      kind: "catalog",
      fileKey: `imports/${companyId}/x.csv`,
    })
    .returning({ id: importJobs.id });
  const [exportJob] = await database
    .insert(exportJobs)
    .values({
      id: crypto.randomUUID(),
      companyId,
      requestedBy: `user:${foreign.userId}`,
      kind: "period_excel",
      filters: { types: ["invoice"], from: "2026-01-01", to: "2026-12-31" },
      formats: ["xlsx"],
    })
    .returning({ id: exportJobs.id });
  const [notification] = await database
    .insert(userNotifications)
    .values({
      id: crypto.randomUUID(),
      companyId,
      userId: foreign.userId,
      kind: "export_ready",
      payload: {},
      idempotencyKey: `matrix:${crypto.randomUUID()}`,
    })
    .returning({ id: userNotifications.id });
  const [statement] = await database
    .insert(bankStatements)
    .values({
      id: crypto.randomUUID(),
      companyId,
      collectionMethodId: method?.id as string,
      format: "csv",
      fileKey: "x",
    })
    .returning({ id: bankStatements.id });
  const [bankTransaction] = await database
    .insert(bankTransactions)
    .values({
      id: crypto.randomUUID(),
      companyId,
      collectionMethodId: method?.id as string,
      statementId: statement?.id as string,
      operationOn: "2026-03-01",
      amountCents: 100,
      concept: "x",
      fingerprint: "matrix",
    })
    .returning({ id: bankTransactions.id });
  const [reconciliation] = await database
    .insert(reconciliations)
    .values({
      id: crypto.randomUUID(),
      companyId,
      bankTransactionId: bankTransaction?.id as string,
      documentId,
      paymentId: payment?.id as string,
      amountCents: 100,
    })
    .returning({ id: reconciliations.id });
  const [template] = await database
    .insert(recurringTemplates)
    .values({
      id: crypto.randomUUID(),
      companyId,
      clientId: foreign.clientId,
      lines: [],
      frequency: "monthly",
      startOn: "2026-12-01",
    })
    .returning({ id: recurringTemplates.id });
  const [oauthClient] = await database
    .insert(oauthClients)
    .values({
      id: crypto.randomUUID(),
      clientId: `client-${crypto.randomUUID()}`,
      redirectUris: ["https://assistant.example.test/callback"],
      name: "Asistente ajeno",
    })
    .returning({ clientId: oauthClients.clientId });
  const [connection] = await database
    .insert(aiConnections)
    .values({
      id: crypto.randomUUID(),
      userId: foreign.userId,
      companyId,
      oauthClientId: oauthClient?.clientId as string,
      clientName: "Asistente ajeno",
    })
    .returning({ id: aiConnections.id });
  const [sample] = await database
    .insert(sampleRenders)
    .values({ id: crypto.randomUUID(), companyId })
    .returning({ id: sampleRenders.id });
  const invite = await inviteAdvisor(
    authenticatedRequest(foreign, "/api/v1/advisor-access", {
      method: "POST",
      body: JSON.stringify({ email: "otra-gestoria@example.test" }),
    }),
  );
  const { id: accessId } = (await invite.json()) as { id: string };
  return {
    stranger,
    ids: {
      "advisor-access": accessId,
      "ai-connections": connection?.id as string,
      "catalog-items": catalogItem?.id as string,
      company: sample?.id as string,
      clients: foreign.clientId,
      "collection-methods": method?.id as string,
      documents: documentId,
      exports: exportJob?.id as string,
      imports: importJob?.id as string,
      notifications: notification?.id as string,
      payments: payment?.id as string,
      "recurring-templates": template?.id as string,
      "bank-transactions": bankTransaction?.id as string,
      reconciliations: reconciliation?.id as string,
      series: series?.id as string,
      "tax-rates": tax?.id as string,
    },
  };
}

describe("any user on a foreign company", () => {
  it("every route with an id answers 404 for another company's resource", async () => {
    const { stranger, ids } = await foreignResources();
    const withId = companyHandlers.filter((handler) =>
      handler.path.includes(":id"),
    );
    expect(
      await mismatches(withId, async (handler) => {
        const resource = handler.path.split("/")[1] as string;
        const id = ids[resource];
        if (!id) {
          return `no foreign fixture for ${resource}`;
        }
        const result = await call(handler, stranger, id);
        // Bodies are `{}`: a route may reject the body (400) before looking
        // the resource up, but it must never act on it or reveal it.
        const allowed =
          handler.method === "GET" || handler.method === "DELETE"
            ? [404]
            : [404, 400];
        return allowed.includes(result.status) ? null : describeResult(result);
      }),
    ).toEqual([]);
  });
});

describe("owner by plan (feature gates)", () => {
  const cases: Array<
    [string, "basic" | "essential" | "pro", string, unknown, number]
  > = [
    [
      "period export",
      "basic",
      "/exports",
      { kind: "period_excel", period: "previous_month" },
      403,
    ],
    [
      "period export",
      "essential",
      "/exports",
      { kind: "period_excel", period: "previous_month" },
      202,
    ],
    [
      "period export",
      "pro",
      "/exports",
      { kind: "period_excel", period: "previous_month" },
      202,
    ],
    [
      "advanced export",
      "essential",
      "/exports",
      {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-01-01",
        to: "2026-01-31",
        formats: ["xlsx"],
      },
      403,
    ],
    [
      "advanced export",
      "pro",
      "/exports",
      {
        kind: "advanced",
        types: ["invoice"],
        from: "2026-01-01",
        to: "2026-01-31",
        formats: ["xlsx"],
      },
      202,
    ],
    [
      "advisor invite",
      "essential",
      "/advisor-access",
      { email: "g@example.test" },
      403,
    ],
    [
      "advisor invite",
      "pro",
      "/advisor-access",
      { email: "g@example.test" },
      201,
    ],
    [
      "advisor schedule",
      "essential",
      "/advisor-schedule",
      { frequency: "monthly", formats: ["xlsx"], enabled: false },
      403,
    ],
    [
      "advisor schedule",
      "pro",
      "/advisor-schedule",
      { frequency: "monthly", formats: ["xlsx"], enabled: false },
      200,
    ],
  ];

  it.each(cases)("%s on %s → %s", async (_name, plan, path, body, status) => {
    const tenant = await createTenant(auth, database, plan);
    const handler = HANDLERS.find(
      (candidate) =>
        candidate.path === path &&
        candidate.method === (path === "/advisor-schedule" ? "PUT" : "POST"),
    ) as RouteHandler;
    const fn = await handler.load();
    const response = await fn(
      authenticatedRequest(tenant, `/api/v1${path}`, {
        method: handler.method,
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status, await response.clone().text()).toBe(status);
    if (status === 403) {
      expect(await response.json()).toMatchObject({
        error: { code: "feature_not_in_plan" },
      });
    }
  });
});
