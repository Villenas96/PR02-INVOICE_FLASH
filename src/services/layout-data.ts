import { cache } from "react";

import { createDatabase } from "@/db";
import type { OnboardingProgress } from "@/lib/onboarding";
import {
  type CompanyRole,
  resolveActiveCompany,
} from "@/services/active-company";
import {
  type CompanySummary,
  loadCompanySummary,
} from "@/services/company-summary";
import { onboardingProgressFor } from "@/services/onboarding";

export interface LayoutData extends CompanySummary {
  role: CompanyRole;
  /** Advisor on a company without Pro (FR-051): show the pause notice. */
  suspended: boolean;
  onboarding: OnboardingProgress;
}

/**
 * Data for the authenticated app shell (fiscal-data banner, quota counters,
 * plan and navigation) for the session's active company, which may be an
 * advised company (FR-052). Computed in the server layout on every render
 * and deduplicated per request with React `cache`; client mutations call
 * `router.refresh()` (useMutation) so this re-runs without a page reload.
 */
export const getLayoutData = cache(
  async (userId: string, sessionId: string): Promise<LayoutData | null> => {
    const database = createDatabase();
    const active = await resolveActiveCompany(database, { userId, sessionId });
    if (!active) {
      return null;
    }
    const summary = await loadCompanySummary(database, active.companyId);
    if (!summary) {
      return null;
    }
    return {
      ...summary,
      role: active.role,
      suspended: active.suspended,
      onboarding: await onboardingProgressFor(database, summary.company),
    };
  },
);
