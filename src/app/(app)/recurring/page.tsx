import Link from "next/link";

import { OwnerOnly } from "@/components/access/owner-only";
import { ProRoute } from "@/components/plan/pro-route";
import { RecurringList } from "@/components/recurring/recurring-list";
import { Button } from "@/components/ui/button";

export default function RecurringPage() {
  return (
    <ProRoute feature="recurring">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Facturas recurrentes
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Se generan solas con la periodicidad que elijas.
            </p>
          </div>
          <OwnerOnly>
            <Button asChild>
              <Link href="/recurring/new">Nueva recurrencia</Link>
            </Button>
          </OwnerOnly>
        </div>
        <RecurringList />
      </div>
    </ProRoute>
  );
}
