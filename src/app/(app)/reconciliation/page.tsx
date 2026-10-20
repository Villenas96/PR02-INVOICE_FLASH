import { OwnerOnly } from "@/components/access/owner-only";
import { ProRoute } from "@/components/plan/pro-route";
import { ReconciliationView } from "@/components/reconciliation/reconciliation-view";

export default function ReconciliationPage() {
  return (
    <ProRoute feature="bank_reconciliation">
      <OwnerOnly>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Conciliación
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Casa los ingresos de tu banco con tus facturas y registra los
              cobros.
            </p>
          </div>
          <ReconciliationView />
        </div>
      </OwnerOnly>
    </ProRoute>
  );
}
