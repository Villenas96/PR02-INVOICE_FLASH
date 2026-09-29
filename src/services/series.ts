import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { companies } from "@/db/schema/company";
import {
  documentSeries,
  type documentTypeEnum,
} from "@/db/schema/document-series";

type DocumentType = (typeof documentTypeEnum.enumValues)[number];

const DEFAULT_PREFIXES: Record<DocumentType, (year: number) => string> = {
  invoice: (year) => `${year}-`,
  proforma: (year) => `PRO-${year}-`,
  receipt: (year) => `REC-${year}-`,
};

function currentMadridYear(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Madrid",
      year: "numeric",
    }).format(now),
  );
}

/**
 * Bootstraps the one default series a company needs for a given document
 * type, the first time it is requested. Invoices are ensured when the
 * editor loads its series list; proformas the same way; receipts are never
 * user-selectable, so their series is ensured lazily by the receipt service
 * right before the first receipt is issued.
 */
export async function ensureDefaultSeries(
  database: Database,
  companyId: string,
  docType: DocumentType,
  now = new Date(),
): Promise<void> {
  const [existingSeries] = await database
    .select({ id: documentSeries.id })
    .from(documentSeries)
    .where(
      and(
        eq(documentSeries.companyId, companyId),
        eq(documentSeries.documentType, docType),
      ),
    )
    .limit(1);

  if (existingSeries) {
    return;
  }

  const prefix = DEFAULT_PREFIXES[docType](currentMadridYear(now));

  await database.execute(sql`
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
      ${crypto.randomUUID()},
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
  `);
}
