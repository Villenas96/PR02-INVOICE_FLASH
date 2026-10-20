import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { auth } from "@/lib/auth";
import { type Feature, hasFeature } from "@/lib/plan";
import { getLayoutData } from "@/services/layout-data";

/**
 * Server wrapper for Pro pages (FR-058): direct access without the feature
 * shows a short explanation with an upgrade invitation, never an error. The
 * API still enforces the feature on every request.
 */
export async function ProRoute({
  feature,
  children,
}: {
  feature: Feature;
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const summary = await getLayoutData(session.user.id, session.session.id);
  if (!summary || !hasFeature(summary.plan, feature)) {
    return <FeatureUpsell feature={feature} />;
  }
  return children;
}
