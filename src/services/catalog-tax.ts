import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { taxRates } from "@/db/schema/tax-rate";
import { ResourceNotFoundError } from "@/lib/api/errors";
import { getDefaultTaxRate, normalizeRate } from "@/services/tax-rates";

/**
 * Resolves a catalog item's proposed tax (FR-023): a tax type id wins and
 * fixes the numeric rate; a bare rate is kept as-is; nothing → the default
 * tax type. Foreign tax ids are a 404.
 */
export async function resolveCatalogTax(
  database: Database,
  companyId: string,
  input: { tax_rate?: string; tax_rate_id?: string | null },
  { useDefault }: { useDefault: boolean },
): Promise<{ taxRate?: string; taxRateId?: string | null }> {
  if (input.tax_rate_id) {
    const [tax] = await database
      .select({ id: taxRates.id, rate: taxRates.rate })
      .from(taxRates)
      .where(
        and(
          eq(taxRates.id, input.tax_rate_id),
          eq(taxRates.companyId, companyId),
        ),
      )
      .limit(1);
    if (!tax) {
      throw new ResourceNotFoundError();
    }
    return { taxRate: tax.rate, taxRateId: tax.id };
  }
  if (input.tax_rate !== undefined) {
    return {
      taxRate: normalizeRate(input.tax_rate),
      ...(input.tax_rate_id === null ? { taxRateId: null } : {}),
    };
  }
  if (useDefault) {
    const tax = await getDefaultTaxRate(database, companyId);
    return { taxRate: tax?.rate ?? "21.00", taxRateId: tax?.id ?? null };
  }
  return input.tax_rate_id === null ? { taxRateId: null } : {};
}
