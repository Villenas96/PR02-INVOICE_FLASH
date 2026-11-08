import { asc, eq } from "drizzle-orm";

import { createDatabase } from "@/db";
import { billingPrices } from "@/db/schema/billing-price";
import { runRoute } from "@/lib/api/route";
import { isProCheckoutEnabled } from "@/lib/env";
import {
  DOCUMENT_TYPES,
  documentLimit,
  featuresFor,
  PLANS,
  planLabel,
} from "@/lib/plan";
import { resolveCompanyContext } from "@/services/context";

/**
 * Plan comparison (FR-007): prices from the synced `billing_price` table,
 * limits and features from `src/lib/plan.ts`, and the current plan.
 */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "billing.plans_failed", async () => {
    const context = await resolveCompanyContext(request, { access: "read" });
    const prices = await createDatabase()
      .select()
      .from(billingPrices)
      .where(eq(billingPrices.active, true))
      .orderBy(asc(billingPrices.unitAmountCents));
    const proEnabled = isProCheckoutEnabled();

    return Response.json({
      current_plan: context.plan,
      plans: PLANS.map((plan) => ({
        plan,
        label: planLabel(plan),
        current: plan === context.plan,
        purchasable: plan === "essential" || (plan === "pro" && proEnabled),
        coming_soon: plan === "pro" && !proEnabled,
        limits: DOCUMENT_TYPES.map((documentType) => ({
          document_type: documentType,
          limit: documentLimit(plan, documentType),
        })),
        features: featuresFor(plan),
        prices: prices
          .filter((price) => price.plan === plan)
          .map((price) => ({
            lookup_key: price.lookupKey,
            interval: price.interval,
            unit_amount_cents: price.unitAmountCents,
            currency: price.currency,
          })),
      })),
    });
  });
}
