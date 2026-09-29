import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Database } from "@/db";
import * as schema from "@/db/schema";

const BUSINESS_TABLES = [
  "document_event",
  "email_delivery",
  "share_link",
  "payment",
  "document_line",
  "document",
  "document_series",
  "catalog_item",
  "client",
  "company",
  "session",
  "account",
  "verification",
  "user",
] as const;

export function integrationDatabaseUrl(): string {
  const url = process.env.INTEGRATION_DATABASE_URL;

  if (!url) {
    throw new Error(
      "INTEGRATION_DATABASE_URL es obligatoria: las pruebas de integración nunca usan DATABASE_URL.",
    );
  }

  return url;
}

let integrationClient: ReturnType<typeof postgres> | undefined;
let integrationDatabase: Database | undefined;
let queryCounter: { count: number } | undefined;

/**
 * Counts the statements `action` sends through the integration database
 * client, i.e. its database round trips. Used by the performance suite to
 * catch regressions that add sequential queries to a request.
 */
export async function countQueries<T>(
  action: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  const counter = { count: 0 };
  queryCounter = counter;
  try {
    const result = await action();
    return { result, queries: counter.count };
  } finally {
    queryCounter = undefined;
  }
}

export function createIntegrationDatabase(): Database {
  if (!integrationClient) {
    integrationClient = postgres(integrationDatabaseUrl(), {
      max: 10,
      idle_timeout: 1,
      debug: () => {
        if (queryCounter) {
          queryCounter.count += 1;
        }
      },
    });
  }
  if (!integrationDatabase) {
    integrationDatabase = drizzle({
      client: integrationClient,
      schema,
    }) as unknown as Database;
  }
  return integrationDatabase;
}

export async function closeIntegrationDatabase(): Promise<void> {
  await integrationClient?.end({ timeout: 5 });
  integrationClient = undefined;
  integrationDatabase = undefined;
}

export async function truncateIntegrationDatabase(): Promise<void> {
  const db = createIntegrationDatabase();
  const tables = BUSINESS_TABLES.map((table) => `"${table}"`).join(", ");
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`),
  );
}
