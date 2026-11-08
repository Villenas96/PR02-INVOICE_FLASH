import Link from "next/link";
import { Suspense } from "react";
import { OwnerOnly } from "@/components/access/owner-only";
import { ImportWizard } from "@/components/catalog/import-wizard";
import { ProRoute } from "@/components/plan/pro-route";

export default function CatalogImportPage() {
  return (
    <OwnerOnly>
      <ProRoute feature="catalog_import">
        <div className="space-y-6">
          <div>
            <Link
              href="/catalog"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Catálogo
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Importar productos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Trae tu lista de servicios y productos desde un CSV.
            </p>
          </div>
          <Suspense>
            <ImportWizard />
          </Suspense>
        </div>
      </ProRoute>
    </OwnerOnly>
  );
}
