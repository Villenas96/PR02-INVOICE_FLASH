import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { ProDashboard } from "@/components/dashboard/pro-dashboard";
import { SimpleHome } from "@/components/dashboard/simple-home";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/plan";
import { getLayoutData } from "@/services/layout-data";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const [summary, query] = await Promise.all([
    getLayoutData(session.user.id, session.session.id),
    searchParams,
  ]);
  const showFull =
    summary?.effectiveUi === "full" ||
    (query.view === "full" && summary?.plan === "pro");

  if (!showFull) {
    return <SimpleHome />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Panel de cobros
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identifica en una sola pantalla qué facturas están cobradas,
          pendientes o vencidas.
        </p>
      </div>
      {summary && hasFeature(summary.plan, "dashboard_full") ? (
        <ProDashboard />
      ) : null}
      <DashboardView />
    </div>
  );
}
