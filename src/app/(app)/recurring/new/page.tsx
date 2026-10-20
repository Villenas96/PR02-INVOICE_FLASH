import { OwnerOnly } from "@/components/access/owner-only";
import { ProRoute } from "@/components/plan/pro-route";
import { RecurringForm } from "@/components/recurring/recurring-form";

export default function NewRecurringPage() {
  return (
    <ProRoute feature="recurring">
      <OwnerOnly>
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            Nueva recurrencia
          </h1>
          <RecurringForm />
        </div>
      </OwnerOnly>
    </ProRoute>
  );
}
