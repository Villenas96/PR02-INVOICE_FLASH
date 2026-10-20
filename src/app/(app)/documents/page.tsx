import Link from "next/link";

import { DocumentList } from "@/components/documents/document-list";
import { Button } from "@/components/ui/button";
import { CREATABLE_DOCUMENT_TYPES } from "@/lib/documents/creatable";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/plan";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await searchParams;
  const documentType =
    typeof type === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(type)
      ? (type as DocumentType)
      : undefined;
  const plural = documentType
    ? DOCUMENT_TYPE_LABELS[documentType].plural
    : undefined;
  const newType =
    documentType && CREATABLE_DOCUMENT_TYPES.includes(documentType)
      ? documentType
      : "invoice";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Documentos
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {plural
              ? plural.charAt(0).toUpperCase() + plural.slice(1)
              : "Facturas y borradores"}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Consulta el ciclo de vida y el estado de cobro sin perder el
            historial.
          </p>
        </div>
        <Button asChild>
          <Link href={`/documents/new?type=${newType}`}>
            {newType === "invoice"
              ? "Nueva factura"
              : `Nuevo: ${DOCUMENT_TYPE_LABELS[newType].singular.toLowerCase()}`}
          </Link>
        </Button>
      </div>

      <DocumentList key={documentType ?? "all"} initialType={documentType} />
    </div>
  );
}
