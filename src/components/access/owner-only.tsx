import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { getLayoutData } from "@/services/layout-data";

/**
 * Server wrapper for pages that only make sense for the owner (creating or
 * editing, settings, subscription): an advisor sees a short explanation
 * instead. The API denies every write regardless (FR-051).
 */
export async function OwnerOnly({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const summary = await getLayoutData(session.user.id, session.session.id);
  if (summary?.role !== "advisor") {
    return children;
  }
  return (
    <section className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-center shadow-sm">
      <h1 className="text-xl font-semibold">Acceso de solo lectura</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Como gestoría puedes consultar documentos, clientes y cobros, descargar
        PDF y exportar. Los cambios los hace la empresa.
      </p>
      <Button asChild className="mt-4">
        <Link href="/documents">Ver documentos</Link>
      </Button>
    </section>
  );
}
