import Link from "next/link";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { Button } from "@/components/ui/button";

/**
 * Home of the simple interface (FR-057): the invoice list with the
 * paid/pending/overdue summary and a prominent «Nueva factura».
 */
export function SimpleHome() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Facturas</h1>
          <p className="text-sm text-muted-foreground">
            Lo cobrado, lo pendiente y lo vencido, de un vistazo.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/documents/new?type=invoice">Nueva factura</Link>
        </Button>
      </div>
      <DashboardView />
    </div>
  );
}
