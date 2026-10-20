import { sql } from "drizzle-orm";

import type { Database } from "@/db";
import { executionRows } from "@/db/result";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";

export const ORPHAN_LOGO_MIN_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ListableBucket {
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string): Promise<void>;
}

async function referencedKeys(
  database: Database,
  keys: string[],
): Promise<Set<string>> {
  if (keys.length === 0) {
    return new Set();
  }
  const keyArray = sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  );
  const result = await database.execute<{ key: string }>(sql`
    SELECT candidate.key
    FROM unnest(ARRAY[${keyArray}]::text[]) AS candidate(key)
    WHERE EXISTS (SELECT 1 FROM ${companies} WHERE logo_key = candidate.key)
      OR EXISTS (SELECT 1 FROM ${clients} WHERE logo_key = candidate.key)
      OR EXISTS (
        SELECT 1 FROM ${documents}
        WHERE (issuer_snapshot ->> 'logoKey') = candidate.key
      )
      OR EXISTS (
        SELECT 1 FROM ${documents}
        WHERE (client_snapshot ->> 'logoKey') = candidate.key
      )
  `);
  return new Set(executionRows<{ key: string }>(result).map((row) => row.key));
}

/**
 * Deletes content-addressed logos (`logos/…`) older than 24 h that no
 * company, client or issued-document snapshot references (research R10).
 * Recent uploads are kept so a logo being saved is never raced away.
 */
export async function purgeOrphanLogos(dependencies: {
  database: Database;
  bucket: ListableBucket;
  now?: Date;
  pageSize?: number;
}): Promise<number> {
  const now = dependencies.now ?? new Date();
  const cutoff = now.getTime() - ORPHAN_LOGO_MIN_AGE_MS;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = await dependencies.bucket.list({
      prefix: "logos/",
      cursor,
      limit: dependencies.pageSize ?? 1_000,
    });
    const candidates = page.objects
      .filter((object) => object.uploaded.getTime() < cutoff)
      .map((object) => object.key);
    const referenced = await referencedKeys(dependencies.database, candidates);
    for (const key of candidates) {
      if (!referenced.has(key)) {
        await dependencies.bucket.delete(key);
        deleted += 1;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}
