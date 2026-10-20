import { eq } from "drizzle-orm";
import { cache } from "react";

import { createDatabase } from "@/db";
import { companies } from "@/db/schema/company";
import {
  type CompanySummary,
  loadCompanySummary,
} from "@/services/company-summary";

/**
 * Data for the authenticated app shell (fiscal-data banner, quota counters,
 * plan and navigation). Computed in the server layout on every render and
 * deduplicated per request with React `cache`; client mutations call
 * `router.refresh()` (useMutation) so this re-runs without a page reload.
 */
export const getLayoutData = cache(
  async (userId: string): Promise<CompanySummary | null> => {
    const database = createDatabase();
    const [company] = await database
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.userId, userId))
      .limit(1);
    return company ? loadCompanySummary(database, company.id) : null;
  },
);
