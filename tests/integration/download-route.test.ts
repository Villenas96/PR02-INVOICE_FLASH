import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportJobs } from "@/db/schema";
import { createDownloadToken } from "@/lib/download-tokens";
import { exportObjectKey } from "@/lib/exports/files";

import { InMemoryBucket } from "./bucket";
import { createIntegrationDatabase } from "./database";
import { createOwner } from "./fixtures";

const SECRET = "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_SECRET = SECRET;

const cloudflareState = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: cloudflareState.env }),
}));

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));

const { GET } = await import("@/app/x/[token]/route");

let bucket: InMemoryBucket;

beforeEach(() => {
  bucket = new InMemoryBucket();
  cloudflareState.env = { STORAGE_BUCKET: bucket };
});

async function seedExport(
  overrides: Partial<typeof exportJobs.$inferInsert> = {},
  now = new Date(),
): Promise<string> {
  const owner = await createOwner(database);
  const { token, hash, expiresAt } = await createDownloadToken(SECRET, now);
  const key = exportObjectKey(owner.companyId, "periodo-2026-09.xlsx");
  await bucket.put(key, "xlsx-bytes");
  await database.insert(exportJobs).values({
    id: crypto.randomUUID(),
    companyId: owner.companyId,
    requestedBy: `user:${owner.userId}`,
    kind: "period_excel",
    filters: { types: ["invoice"], from: "2026-09-01", to: "2026-09-30" },
    formats: ["xlsx"],
    status: "ready",
    fileKeys: [
      {
        key,
        filename: "Facturas septiembre 2026.xlsx",
        content_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
    downloadTokenHash: hash,
    expiresAt,
    ...overrides,
  });
  return token;
}

function download(token: string, headers: HeadersInit = {}) {
  return GET(new Request(`http://localhost:3000/x/${token}`, { headers }), {
    params: Promise.resolve({ token }),
  });
}

describe("GET /x/:token", () => {
  it("serves a ready export as an attachment", async () => {
    const token = await seedExport();
    const response = await download(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "Facturas%20septiembre%202026.xlsx",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("xlsx-bytes");
  });

  it("answers the same generic 404 for every invalid case", async () => {
    const expired = await seedExport(
      {},
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000),
    );
    const notReady = await seedExport({ status: "running" });
    const unknown = (await createDownloadToken(SECRET)).token;
    const forged = (
      await createDownloadToken("another-secret-at-least-thirty-two-chars")
    ).token;

    const bodies = new Set<string>();
    for (const token of [expired, notReady, unknown, forged, "nope"]) {
      const response = await download(token);
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { code: string } };
      bodies.add(JSON.stringify(body.error.code));
    }
    expect(bodies).toEqual(new Set(['"resource_not_found"']));
  });

  it("rejects an out-of-range file index", async () => {
    const token = await seedExport();
    const response = await GET(
      new Request(`http://localhost:3000/x/${token}?f=3`),
      { params: Promise.resolve({ token }) },
    );
    expect(response.status).toBe(404);
  });

  it("is rate limited by IP", async () => {
    const token = await seedExport();
    const keys: string[] = [];
    cloudflareState.env = {
      STORAGE_BUCKET: bucket,
      EXPORT_RATE_LIMITER: {
        limit: ({ key }: { key: string }) => {
          keys.push(key);
          return Promise.resolve({ success: false });
        },
      },
    };
    const response = await download(token, {
      "cf-connecting-ip": "203.0.113.9",
    });
    expect(response.status).toBe(429);
    expect(keys).toEqual(["203.0.113.9"]);
  });
});
