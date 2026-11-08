import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { executionRows } from "@/db/result";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { documentTypeEnum } from "@/db/schema/document-series";
import { getCompanyReadiness } from "@/lib/documents";
import {
  type DocumentType,
  effectiveUiMode,
  type Feature,
  featuresFor,
  getMadridMonthBounds,
  type Plan,
  type TypeUsage,
  type UiMode,
  usageFor,
} from "@/lib/plan";
import { getDefaultTaxRate } from "@/services/tax-rates";

export type CompanyRow = typeof companies.$inferSelect;
export type MissingCompanyField = "legal_name" | "tax_id" | "address";

export interface CompanySummary {
  company: CompanyRow;
  plan: Plan;
  /** One entry per issuable document type, invoices first. */
  usage: TypeUsage[];
  features: Feature[];
  uiMode: UiMode | null;
  effectiveUi: UiMode;
  /** Types with at least one (non-deleted) document, for the simple UI. */
  usedDocumentTypes: DocumentType[];
  missingFields: MissingCompanyField[];
  /** Rate of the default tax type (v1 `default_tax_rate`). */
  defaultTaxRate: string;
  /** What is still needed before the first issue (FR-048 «qué falta»). */
  missingToIssue: MissingCompanyField[];
}

const ISSUABLE_TYPES = documentTypeEnum.enumValues as readonly DocumentType[];

function missingFieldName(
  field: "address" | "legalName" | "taxId",
): MissingCompanyField {
  if (field === "legalName") {
    return "legal_name";
  }
  if (field === "taxId") {
    return "tax_id";
  }
  return field;
}

async function monthlyUsageByType(
  database: Database,
  companyId: string,
  now: Date,
): Promise<Map<DocumentType, number>> {
  const { start, endExclusive } = getMadridMonthBounds(now);
  const rows = await database
    .select({
      documentType: documents.documentType,
      used: sql<number>`count(*)::integer`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        inArray(documents.status, ["issued", "voided"]),
        gte(documents.issuedAt, start),
        lt(documents.issuedAt, endExclusive),
      ),
    )
    .groupBy(documents.documentType);
  return new Map(rows.map((row) => [row.documentType, Number(row.used)]));
}

async function usedDocumentTypes(
  database: Database,
  companyId: string,
): Promise<DocumentType[]> {
  // One indexed EXISTS per type (document_company_type_status_issue_date_idx)
  // instead of a DISTINCT over every document of the company.
  const typeArray = sql.join(
    ISSUABLE_TYPES.map((type) => sql`${type}`),
    sql`, `,
  );
  const result = await database.execute<{ document_type: DocumentType }>(sql`
    SELECT candidate.document_type
    FROM unnest(ARRAY[${typeArray}]::document_type[]) AS candidate(document_type)
    WHERE EXISTS (
      SELECT 1
      FROM ${documents} existing
      WHERE existing.company_id = ${companyId}
        AND existing.document_type = candidate.document_type
        AND existing.deleted_at IS NULL
    )
  `);
  const used = new Set(
    executionRows<{ document_type: DocumentType }>(result).map(
      (row) => row.document_type,
    ),
  );
  return ISSUABLE_TYPES.filter((type) => used.has(type));
}

export function summarizeCompany(
  company: CompanyRow,
  usageByType: Map<DocumentType, number>,
  usedTypes: DocumentType[],
  defaultTaxRate = "21.00",
): CompanySummary {
  const plan = company.plan;
  const readiness = getCompanyReadiness(company);
  const missingFields = readiness.missingFields.map(missingFieldName);

  return {
    company,
    plan,
    usage: ISSUABLE_TYPES.map((type) =>
      usageFor(plan, type, usageByType.get(type) ?? 0),
    ),
    features: featuresFor(plan),
    uiMode: company.uiMode,
    effectiveUi: effectiveUiMode(plan, company.uiMode),
    usedDocumentTypes: usedTypes,
    missingFields,
    defaultTaxRate,
    missingToIssue: missingFields,
  };
}

/** Loads the company and its derived plan state in parallel queries. */
export async function loadCompanySummary(
  database: Database,
  companyId: string,
  now = new Date(),
): Promise<CompanySummary | null> {
  const [companyRows, usageByType, usedTypes, defaultTax] = await Promise.all([
    database
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1),
    monthlyUsageByType(database, companyId, now),
    usedDocumentTypes(database, companyId),
    getDefaultTaxRate(database, companyId),
  ]);
  const company = companyRows[0];
  return company
    ? summarizeCompany(company, usageByType, usedTypes, defaultTax?.rate)
    : null;
}

export function usageResponse(usage: TypeUsage) {
  return {
    document_type: usage.documentType,
    used: usage.used,
    limit: usage.limit,
    warning: usage.warning,
    reached: usage.reached,
  };
}
