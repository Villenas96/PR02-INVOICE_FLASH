import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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

function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL es obligatoria y debe apuntar a una base aislada.",
    );
  }
  if (process.env.DATABASE_URL === url) {
    throw new Error(
      "E2E_DATABASE_URL no puede reutilizar la base indicada por DATABASE_URL.",
    );
  }
  return url;
}

export default async function setupE2eDatabase(): Promise<void> {
  const client = postgres(e2eDatabaseUrl(), { max: 1 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: resolve("src/db/migrations"),
    });
    const tables = BUSINESS_TABLES.map((table) => `"${table}"`).join(", ");
    await client.unsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end({ timeout: 5 });
  }
}
