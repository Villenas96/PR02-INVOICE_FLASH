import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "./database";

const MIGRATIONS_FOLDER = resolve("src/db/migrations");
/** First migration of feature 002; every later one must be reversible. */
const FIRST_V2_MIGRATION_INDEX = 4;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

async function journal(): Promise<JournalEntry[]> {
  const raw = await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function databaseUrlFor(name: string): string {
  const url = new URL(integrationDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

describe("v2 migrations are reversible", () => {
  it("applies up → down → up for every migration since 0004", async () => {
    const entries = (await journal()).filter(
      (entry) => entry.idx >= FIRST_V2_MIGRATION_INDEX,
    );
    expect(entries.length).toBeGreaterThan(0);

    const name = `reversible_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(integrationDatabaseUrl(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    try {
      const client = postgres(databaseUrlFor(name), {
        max: 1,
        onnotice: () => {},
      });
      try {
        await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

        for (const entry of [...entries].reverse()) {
          const down = await readFile(
            `${MIGRATIONS_FOLDER}/${entry.tag}.down.sql`,
            "utf8",
          );
          await client.unsafe(down);
          await client`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at = ${entry.when}
          `;
        }

        await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
        const [{ applied }] = await client<{ applied: number }[]>`
          SELECT count(*)::integer AS applied FROM drizzle.__drizzle_migrations
        `;
        expect(applied).toBe((await journal()).length);
      } finally {
        await client.end({ timeout: 5 });
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });
});
