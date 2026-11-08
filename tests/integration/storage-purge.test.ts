import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { clients, companies, documents } from "@/db/schema";
import { purgeOrphanLogos } from "@/services/storage-purge";

import { createIntegrationDatabase } from "./database";
import { createOwner, createSeries, seedIssuedDocuments } from "./fixtures";

const database = createIntegrationDatabase();
const HOUR_MS = 60 * 60 * 1_000;

class MemoryBucket {
  objects = new Map<string, Date>();

  put(key: string, uploaded: Date) {
    this.objects.set(key, uploaded);
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1_000;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return {
      objects: page.map((key) => ({
        key,
        uploaded: this.objects.get(key) as Date,
      })),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async get() {
    return null;
  }
}

describe("orphan logo purge", () => {
  it("deletes only old logos that nothing references", async () => {
    const now = new Date("2026-10-20T03:00:00.000Z");
    const old = new Date(now.getTime() - 48 * HOUR_MS);
    const owner = await createOwner(database);
    const prefix = `logos/${owner.companyId}`;
    const current = `${prefix}/current.png`;
    const clientLogo = `${prefix}/client.png`;
    const frozenIssuer = `${prefix}/frozen-issuer.png`;
    const frozenClient = `${prefix}/frozen-client.jpg`;
    const orphan = `${prefix}/orphan.png`;
    const recent = `${prefix}/recent.png`;
    const bucket = new MemoryBucket();
    for (const key of [
      current,
      clientLogo,
      frozenIssuer,
      frozenClient,
      orphan,
    ]) {
      bucket.put(key, old);
    }
    bucket.put(recent, new Date(now.getTime() - HOUR_MS));
    bucket.put("documents/x/pdf/v1.pdf", old);

    await database
      .update(companies)
      .set({ logoKey: current })
      .where(eq(companies.id, owner.companyId));
    await database
      .update(clients)
      .set({ logoKey: clientLogo })
      .where(eq(clients.id, owner.clientId));
    const series = await createSeries(database, owner.companyId, "invoice");
    await seedIssuedDocuments(database, owner, {
      documentType: "invoice",
      seriesId: series,
      count: 1,
    });
    await database
      .update(documents)
      .set({
        issuerSnapshot: { legalName: "x", logoKey: frozenIssuer },
        clientSnapshot: { name: "y", logoKey: frozenClient },
      })
      .where(eq(documents.companyId, owner.companyId));

    const deleted = await purgeOrphanLogos({
      database,
      bucket,
      now,
      pageSize: 2,
    });

    expect(deleted).toBe(1);
    expect([...bucket.objects.keys()].sort()).toEqual(
      [
        clientLogo,
        current,
        "documents/x/pdf/v1.pdf",
        frozenClient,
        frozenIssuer,
        recent,
      ].sort(),
    );
  });
});
