import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { toApiError } from "@/lib/api/errors";
import { issueDocument } from "@/services/document-issuance";

import { createIntegrationDatabase, integrationDatabaseUrl } from "./database";
import {
  createDraft,
  createOwner,
  createSeries,
  type FixturePlan,
  recordingQueue,
  seedIssuedDocuments,
} from "./fixtures";

const database = createIntegrationDatabase();

function databaseUrlFor(name: string): string {
  const url = new URL(integrationDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

describe("plan tier migration (expand/contract)", () => {
  it("migrates a fresh database through every migration in a single run", async () => {
    const name = `plan_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(integrationDatabaseUrl(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    try {
      const client = postgres(databaseUrlFor(name), { max: 1 });
      try {
        await migrate(drizzle(client), {
          migrationsFolder: resolve("src/db/migrations"),
        });
        const [{ labels }] = await client<{ labels: string[] }[]>`
          SELECT enum_range(NULL::plan)::text[] AS labels
        `;
        expect(labels).toEqual(
          expect.arrayContaining(["basic", "essential", "pro"]),
        );
      } finally {
        await client.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });

  it.each<[FixturePlan, number]>([
    ["free", 5],
    ["basic", 5],
    ["essential", 100],
    ["pro", 100],
  ])(
    "issues with the %s plan value and enforces its limit",
    async (plan, limit) => {
      const owner = await createOwner(database, { plan });
      const seriesId = await createSeries(database, owner.companyId, "invoice");
      const queue = recordingQueue();

      const firstDraft = await createDraft(database, owner);
      const issued = await issueDocument(
        {
          companyId: owner.companyId,
          documentId: firstDraft,
          actor: owner.userId,
        },
        { database, queue },
      );
      expect(issued.status).toBe("issued");

      await seedIssuedDocuments(database, owner, {
        documentType: "invoice",
        seriesId,
        count: limit - 1,
        issuedAt: issued.issuedAt,
        startNumber: 2,
      });
      const blockedDraft = await createDraft(database, owner);
      const error = await issueDocument(
        {
          companyId: owner.companyId,
          documentId: blockedDraft,
          actor: owner.userId,
        },
        { database, queue },
      ).catch((caught: unknown) => caught);
      expect(toApiError(error)).toMatchObject({
        code: "plan_limit_reached",
        status: 402,
      });
    },
  );
});
