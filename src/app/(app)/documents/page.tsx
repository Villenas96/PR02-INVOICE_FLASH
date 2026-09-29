import Link from "next/link";

import { DocumentList } from "@/components/documents/document-list";
import { Button } from "@/components/ui/button";

export default function DocumentsPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Documentos
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Facturas y borradores
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Consulta el ciclo de vida y el estado de cobro sin perder el
            historial.
          </p>
        </div>
        <Button asChild>
          <Link href="/documents/new">Nueva factura</Link>
        </Button>
      </div>

      <DocumentList />
    </div>
  );
}
