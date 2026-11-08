import { OwnerOnly } from "@/components/access/owner-only";
import type { EditableDocumentType } from "@/components/documents/editor/document-type-selector";
import { InvoiceEditor } from "@/components/documents/editor/invoice-editor";
import { CREATABLE_DOCUMENT_TYPES } from "@/lib/documents/creatable";
import { documentTypeLabel } from "@/lib/documents/labels";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await searchParams;
  const initialType = (
    typeof type === "string" &&
    (CREATABLE_DOCUMENT_TYPES as readonly string[]).includes(type)
      ? type
      : "invoice"
  ) as EditableDocumentType;
  const label = documentTypeLabel(initialType);

  return (
    <OwnerOnly>
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            {initialType === "invoice" ? "Nueva factura" : `Nuevo documento`}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {initialType === "invoice"
              ? "Prepara tu factura"
              : `Prepara tu ${label.toLowerCase()}`}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            El borrador no consume numeración ni cuenta para el límite mensual.
          </p>
        </div>
        <InvoiceEditor key={initialType} initialType={initialType} />
      </div>
    </OwnerOnly>
  );
}
