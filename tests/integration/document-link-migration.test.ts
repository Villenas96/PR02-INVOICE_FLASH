import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "./database";

const MIGRATIONS = resolve("src/db/migrations");

function databaseUrlFor(name: string): string {
  const url = new URL(integrationDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

/** Copy of the migrations folder whose journal stops before `tag`. */
async function migrationsBefore(tag: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "migrations-"));
  await cp(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, index);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

describe("0009_quotes_delivery_notes data migration", () => {
  it("moves v1 converted_from/converted_to pairs into document_link", async () => {
    const name = `link_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(integrationDatabaseUrl(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const partial = await migrationsBefore("0009_quotes_delivery_notes");
    try {
      const client = postgres(databaseUrlFor(name), {
        max: 1,
        onnotice: () => {},
      });
      try {
        await migrate(drizzle(client), { migrationsFolder: partial });
        const [userId, companyId, proformaId, invoiceId, loneId] = [
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ];
        await client`
          INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
          VALUES (${userId}, 'Migración', ${`${userId}@example.test`}, true, now(), now())
        `;
        await client`
          INSERT INTO company (id, user_id, email) VALUES (${companyId}, ${userId}, 'm@example.test')
        `;
        await client`
          INSERT INTO document (id, company_id, document_type, status, issue_date)
          VALUES (${proformaId}, ${companyId}, 'proforma', 'draft', '2026-01-10')
        `;
        await client`
          INSERT INTO document (id, company_id, document_type, status, issue_date, converted_from_id)
          VALUES (${invoiceId}, ${companyId}, 'invoice', 'draft', '2026-01-11', ${proformaId})
        `;
        await client`
          UPDATE document SET converted_to_id = ${invoiceId} WHERE id = ${proformaId}
        `;
        await client`
          INSERT INTO document (id, company_id, document_type, status, issue_date)
          VALUES (${loneId}, ${companyId}, 'invoice', 'draft', '2026-01-12')
        `;

        await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });

        const links = await client<
          { source: string; target: string; kind: string }[]
        >`
          SELECT source_document_id AS source, target_document_id AS target, kind::text
          FROM document_link WHERE company_id = ${companyId}
        `;
        expect(links).toEqual([
          { source: proformaId, target: invoiceId, kind: "converted" },
        ]);
        const columns = await client<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'document' AND column_name LIKE 'converted_%'
        `;
        expect(columns).toHaveLength(0);
      } finally {
        await client.end({ timeout: 5 });
      }
    } finally {
      await rm(partial, { recursive: true, force: true });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });
});
