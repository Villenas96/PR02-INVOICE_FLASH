import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { clients, companies, users } from "@/db/schema";

import {
  createIntegrationDatabase,
  truncateIntegrationDatabase,
} from "../integration/database";
import {
  CLIENT_FIXTURE_COUNT,
  generateClientFixtures,
  SEARCH_NEEDLE_TERM,
} from "./fixtures/clients";

const database = createIntegrationDatabase();
const SEARCH_P95_MS = 200;
const ITERATIONS = 20;
const INSERT_BATCH_SIZE = 500;

function percentile(durationsMs: number[], p: number): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

describe("client search performance", () => {
  it(`keeps indexed name/tax-id search p95 under ${SEARCH_P95_MS}ms across ${CLIENT_FIXTURE_COUNT} clients`, async () => {
    await truncateIntegrationDatabase();
    const now = new Date();
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    await database.insert(users).values({
      id: userId,
      name: "Rendimiento",
      email: `perf-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(companies).values({
      id: companyId,
      userId,
      legalName: "Empresa Rendimiento, S.L.",
      taxId: "B12345678",
      address: "Calle del Rendimiento 1, Madrid",
      email: "perf@example.test",
      createdAt: now,
      updatedAt: now,
    });

    const fixtures = generateClientFixtures();
    for (
      let offset = 0;
      offset < fixtures.length;
      offset += INSERT_BATCH_SIZE
    ) {
      const batch = fixtures.slice(offset, offset + INSERT_BATCH_SIZE);
      await database.insert(clients).values(
        batch.map((row) => ({
          id: row.id,
          companyId,
          name: row.name,
          taxId: row.taxId,
        })),
      );
    }

    const searchTerm = `%${SEARCH_NEEDLE_TERM}%`;
    const durations: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const startedAt = performance.now();
      const rows = await database
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.companyId, companyId),
            sql`${clients.name} ILIKE ${searchTerm}`,
          ),
        )
        .limit(26);
      durations.push(performance.now() - startedAt);
      expect(rows.length).toBe(1);
    }

    const p95 = percentile(durations, 95);
    expect(p95).toBeLessThan(SEARCH_P95_MS);
  }, 60_000);
});
