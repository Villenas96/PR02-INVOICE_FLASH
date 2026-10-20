import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { executionRows } from "@/db/result";
import { companies } from "@/db/schema/company";
import {
  documentSeries,
  type documentTypeEnum,
} from "@/db/schema/document-series";
import { createUuidV7 } from "@/lib/ids";
import { autoSeriesPrefix } from "@/lib/numbering";

type DocumentType = (typeof documentTypeEnum.enumValues)[number];

export interface EnsureSeriesResult {
  /** True only for the call that actually inserted the series. */
  created: boolean;
  prefix: string | null;
  renamed: boolean;
}

function currentMadridYear(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Madrid",
      year: "numeric",
    }).format(now),
  );
}

/**
 * Creates the default series of a document type the first time it is needed
 * (FR-019, research R7): the invoice series uses `{year}-`; any other type
 * reuses the invoice prefix behind its code (`PRO-2026-`). Idempotent under
 * concurrency: the company lock plus `ON CONFLICT DO NOTHING` let a single
 * caller insert it.
 */
export async function ensureDefaultSeries(
  database: Database,
  companyId: string,
  docType: DocumentType,
  now = new Date(),
): Promise<EnsureSeriesResult> {
  const existing = await database
    .select({
      documentType: documentSeries.documentType,
      prefix: documentSeries.prefix,
      isDefault: documentSeries.isDefault,
    })
    .from(documentSeries)
    .where(eq(documentSeries.companyId, companyId));

  if (existing.some((series) => series.documentType === docType)) {
    return { created: false, prefix: null, renamed: false };
  }

  const yearPrefix = `${currentMadridYear(now)}-`;
  const invoicePrefix =
    existing.find(
      (series) => series.documentType === "invoice" && series.isDefault,
    )?.prefix ?? yearPrefix;
  const { prefix, renamed } =
    docType === "invoice"
      ? { prefix: yearPrefix, renamed: false }
      : autoSeriesPrefix(
          docType,
          invoicePrefix,
          existing.map((series) => series.prefix),
        );

  const result = await database.execute<{ id: string }>(sql`
    WITH locked_company AS MATERIALIZED (
      SELECT ${companies.id} AS id
      FROM ${companies}
      WHERE ${companies.id} = ${companyId}
      FOR UPDATE
    )
    INSERT INTO ${documentSeries} (
      ${sql.identifier(documentSeries.id.name)},
      ${sql.identifier(documentSeries.companyId.name)},
      ${sql.identifier(documentSeries.documentType.name)},
      ${sql.identifier(documentSeries.prefix.name)},
      ${sql.identifier(documentSeries.nextNumber.name)},
      ${sql.identifier(documentSeries.isDefault.name)}
    )
    SELECT
      ${createUuidV7(now.getTime())},
      locked_company.id,
      ${docType}::document_type,
      ${prefix},
      1,
      TRUE
    FROM locked_company
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${documentSeries} existing
      WHERE existing.company_id = locked_company.id
        AND existing.document_type = ${docType}::document_type
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);

  return executionRows(result).length > 0
    ? { created: true, prefix, renamed }
    : { created: false, prefix: null, renamed: false };
}

/** Active (non-archived) series of a type, for editor selection checks. */
export async function findSelectableSeries(
  database: Database,
  companyId: string,
  seriesId: string,
) {
  const [series] = await database
    .select({
      id: documentSeries.id,
      documentType: documentSeries.documentType,
      archivedAt: documentSeries.archivedAt,
    })
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.id, seriesId),
        eq(documentSeries.companyId, companyId),
      ),
    )
    .limit(1);
  return series ?? null;
}
