import { DashboardView } from "@/components/dashboard/dashboard-view";

export default function DashboardPage() {
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
      <DashboardView />
    </div>
  );
}
