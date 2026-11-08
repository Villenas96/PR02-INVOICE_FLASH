import { headers } from "next/headers";
import Link from "next/link";

import { CatalogList } from "@/components/catalog/catalog-list";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/plan";
import { getLayoutData } from "@/services/layout-data";

export default async function CatalogPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const summary = session
    ? await getLayoutData(session.user.id, session.session.id)
    : null;
  const canImport = summary
    ? hasFeature(summary.plan, "catalog_import")
    : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Catálogo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Guarda servicios y conceptos habituales para añadirlos rápido a tus
            documentos.
          </p>
        </div>
        {canImport ? (
          <Button asChild variant="outline">
            <Link href="/catalog/import">Importar CSV</Link>
          </Button>
        ) : null}
      </div>
      <CatalogList />
    </div>
  );
}
