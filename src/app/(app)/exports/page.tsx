import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ExportsView } from "@/components/exports/exports-view";
import { FeatureUpsell } from "@/components/plan/feature-upsell";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/plan";
import { getLayoutData } from "@/services/layout-data";

export default async function ExportsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const summary = await getLayoutData(session.user.id, session.session.id);
  if (!summary || !hasFeature(summary.plan, "period_export")) {
    return <FeatureUpsell feature="period_export" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Exportar y gestoría
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prepara la documentación de un periodo para tu asesoría.
        </p>
      </div>
      <ExportsView
        isOwner={summary.role === "owner"}
        advancedEnabled={hasFeature(summary.plan, "advanced_export")}
        scheduleEnabled={hasFeature(summary.plan, "advisor_schedule")}
        initialAdvisorEmail={summary.company.advisorEmail}
      />
    </div>
  );
}
