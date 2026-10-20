import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/** Escapes LIKE wildcards so «50%» or «a_b» are searched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * Accent- and case-insensitive substring match over a generated
 * `search_text` column (migration 0008, GIN trigram index).
 */
export function matchesSearchText(column: AnyColumn, query: string): SQL {
  return sql`${column} LIKE '%' || immutable_unaccent(lower(${escapeLike(query.trim())})) || '%' ESCAPE '\\'`;
}
